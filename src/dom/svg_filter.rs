//! The `filter` element.

use crate::abi::{
    self, BlendMode, INPUT_ALPHA, INPUT_GRAPHIC, INPUT_NOTHING, Item, Matrix, Primitive, Rect,
};
use crate::effects::Subject;
use crate::geometry::translation;
use crate::name::{Name, is_name, name};
use crate::paint::{Painter, Space, blend_mode};
use crate::path::Numbers;
use crate::svg::{Node, href};
use crate::svg_values::ColorInterpolation;
use crate::tree::{Element, Namespace};
use crate::types::*;
use crate::values::Color;

/// What an `feImage` shows.
pub(crate) struct Input<'a> {
    primitive: Node<'a>,
    /// In the user space, and the transform from it.
    subregion: Rect,
    matrix: Matrix,
}

struct Built<'a> {
    name: Option<&'a str>,
    subregion: Rect,
    /// It depends on what scripts must not learn.
    is_tainted: bool,
}

fn numbers(element: &Element, name: Name) -> Option<Vec<f32>> {
    Numbers::all(element.attribute(name)?)
}

fn number(element: &Element, name: Name, default: f32) -> f32 {
    numbers(element, name)
        .filter(|it| it.len() == 1)
        .map_or(default, |it| it[0])
}

fn pair(element: &Element, name: Name, default: f32) -> [f32; 2] {
    match numbers(element, name).as_deref() {
        Some([one]) => [*one; 2],
        Some([x, y]) => [*x, *y],
        _ => [default; 2],
    }
}

fn choice(element: &Element, name: Name, values: &[&str], default: usize) -> usize {
    element
        .attribute(name)
        .and_then(|it| values.iter().position(|value| *value == it))
        .unwrap_or(default)
}

fn color_matrix(element: &Element) -> Vec<f32> {
    let values = numbers(element, name!("values"));
    let turned = |cos: f32, sin: f32| {
        let row = |luminance: usize, by_sin: [f32; 3]| {
            let part = |it: usize| {
                [0.213, 0.715, 0.072][it] * (1.0 - cos)
                    + if it == luminance { cos } else { 0.0 }
                    + sin * by_sin[it]
            };
            [part(0), part(1), part(2), 0.0, 0.0]
        };
        let rows = [
            row(0, [-0.213, -0.715, 0.928]),
            row(1, [0.143, 0.140, -0.283]),
            row(2, [-0.787, 0.715, 0.072]),
            [0.0, 0.0, 0.0, 1.0, 0.0],
        ];
        rows.as_flattened().to_vec()
    };
    match (
        choice(
            element,
            name!("type"),
            &["matrix", "saturate", "hueRotate", "luminanceToAlpha"],
            0,
        ),
        values.as_deref(),
    ) {
        (0, Some(values)) if values.len() == 20 => values.to_vec(),
        (1, Some([amount])) => turned(*amount, 0.0),
        (2, Some([degrees])) => turned(degrees.to_radians().cos(), degrees.to_radians().sin()),
        (3, _) => [0.0; 15]
            .into_iter()
            .chain([0.2125, 0.7154, 0.0721, 0.0, 0.0])
            .collect(),
        _ => (0..20).map(|it| f32::from(it % 6 == 0)).collect(),
    }
}

fn transfer(function: Option<&Element>) -> impl Iterator<Item = f32> {
    let kind = function.map_or(0, |it| {
        choice(
            it,
            name!("type"),
            &["identity", "table", "discrete", "linear", "gamma"],
            0,
        )
    });
    let table = function
        .and_then(|it| numbers(it, name!("tableValues")))
        .unwrap_or_default();
    let get = |name, default| function.map_or(default, |it| number(it, name, default));
    let [slope, intercept] = [get(name!("slope"), 1.0), get(name!("intercept"), 0.0)];
    let [amplitude, exponent, offset] = [
        get(name!("amplitude"), 1.0),
        get(name!("exponent"), 1.0),
        get(name!("offset"), 0.0),
    ];
    (0..256).map(move |value| {
        let (c, last) = (value as f32 / 255.0, table.len().saturating_sub(1));
        let result = match kind {
            1 if !table.is_empty() => {
                let index = (c * last as f32) as usize;
                crate::values::mix(
                    table[index],
                    table[(index + 1).min(last)],
                    c * last as f32 - index as f32,
                )
            }
            2 if !table.is_empty() => table[(value * table.len() / 255).min(last)],
            3 => slope * c + intercept,
            4 => amplitude * c.powf(exponent) + offset,
            _ => c,
        };
        (result * 255.0).round().clamp(0.0, 255.0)
    })
}

fn convolution(element: &Element) -> Option<Vec<f32>> {
    let (order, kernel) = (
        pair(element, name!("order"), 3.0).map(f32::trunc),
        numbers(element, name!("kernelMatrix"))?,
    );
    let target = [(name!("targetX"), 0), (name!("targetY"), 1)]
        .map(|(name, axis)| number(element, name, (order[axis] / 2.0).floor()).trunc());
    (order[0] * order[1] == kernel.len() as f32
        && (0..2).all(|it| order[it] > 0.0 && (0.0..order[it]).contains(&target[it])))
    .then_some(())?;
    let non_zero = |it: f32| (it != 0.0).then_some(it);
    let divisor = non_zero(number(element, name!("divisor"), 0.0))
        .or(non_zero(kernel.iter().sum()))
        .unwrap_or(1.0);
    let edge = choice(
        element,
        name!("edgeMode"),
        &["duplicate", "wrap", "none"],
        0,
    ) as f32;
    let keeps_alpha = f32::from(element.attribute(name!("preserveAlpha")) == Some("true"));
    Some(
        [
            order[0],
            order[1],
            target[0],
            target[1],
            divisor,
            number(element, name!("bias"), 0.0),
            edge,
            keeps_alpha,
        ]
        .into_iter()
        .chain(kernel)
        .collect(),
    )
}

impl<'a> Painter<'a> {
    pub(crate) fn svg_filter(
        &mut self,
        filter: &Node<'a>,
        subject: &Subject,
        inputs: &mut Vec<Input<'a>>,
        is_tainted: &mut bool,
    ) {
        let (document, user) = (filter.document, subject.user_space());
        let region = document.resource_region(filter, name!("filterUnits"), user.bounds);
        let is_relative =
            filter.element.attribute(name!("primitiveUnits")) == Some("objectBoundingBox");
        let (bounds, zoom) = (user.bounds, user.matrix[0]);
        let diagonal = bounds.width.hypot(bounds.height) / core::f32::consts::SQRT_2;
        let unit = (if is_relative {
            [bounds.width, bounds.height, diagonal]
        } else {
            [1.0; 3]
        })
        .map(|it| it * zoom);
        let origin = apply(
            &user.matrix,
            if is_relative {
                [bounds.x, bounds.y]
            } else {
                [0.0; 2]
            },
        );
        let mut built = Vec::<Built>::new();
        self.depends_on_outside();
        self.out
            .filters
            .push(abi::Filter::Graph(region.transformed(&user.matrix)));
        for node in document
            .tree
            .element_children(filter.id)
            .filter_map(|it| document.svg_node(it))
            .take(10_000)
        {
            let element = node.element;
            let children = || {
                document
                    .tree
                    .element_children(node.id)
                    .filter_map(|it| document.tree.element(it))
                    .filter(|it| it.namespace == Namespace::Svg)
            };
            let input = |name: Option<&str>| match name {
                Some("SourceGraphic") => INPUT_GRAPHIC,
                Some("SourceAlpha") => INPUT_ALPHA,
                name => built
                    .iter()
                    .rposition(|it| name.is_some() && it.name == name)
                    .map_or(built.len() as f32 - 1.0, |it| it as f32),
            };
            let (first, second) = (
                input(element.attribute(name!("in"))),
                input(element.attribute(name!("in2"))),
            );
            let color = |color: Color, opacity: f32| {
                let [r, g, b, a] = color
                    .resolve(node.style.color())
                    .to_be_bytes()
                    .map(f32::from);
                [r, g, b, a * opacity]
            };
            let (shape, scaled) = (&node.style.shape, |[x, y]: [f32; 2]| {
                [x * unit[0], y * unit[1]]
            });
            let flood = color(shape.flood_color, shape.flood_opacity.0);
            let offset = |default| {
                scaled([
                    number(element, name!("dx"), default),
                    number(element, name!("dy"), default),
                ])
            };
            let deviation = |default| {
                Some(pair(element, name!("stdDeviation"), default))
                    .filter(|it| it[0] >= 0.0 && it[1] >= 0.0)
                    .map_or([0.0; 2], scaled)
            };
            let nothing = || (Primitive::Flood, vec![], vec![0.0; 4]);
            let same = || (Primitive::Offset, vec![first], vec![0.0; 2]);
            let taints = |input: &f32| {
                built
                    .get(*input as usize)
                    .filter(|_| *input >= 0.0)
                    .map_or(*is_tainted, |it| it.is_tainted)
            };
            let (kind, used, arguments) = match node.tag {
                tag if tag == name!("feBlend") => {
                    let mode = element
                        .attribute(name!("mode"))
                        .and_then(|it| Blend::from_name(it.as_bytes()))
                        .map_or(BlendMode::Normal, blend_mode);
                    (
                        Primitive::Blend,
                        vec![first, second],
                        vec![f32::from(mode as u8 % 16)],
                    )
                }
                tag if tag == name!("feColorMatrix") => {
                    (Primitive::ColorMatrix, vec![first], color_matrix(element))
                }
                tag if tag == name!("feComponentTransfer") => {
                    let tags = [
                        name!("feFuncR"),
                        name!("feFuncG"),
                        name!("feFuncB"),
                        name!("feFuncA"),
                    ];
                    let tables = tags
                        .into_iter()
                        .flat_map(|tag| transfer(children().filter(|it| it.tag == tag).last()));
                    (Primitive::ComponentTransfer, vec![first], tables.collect())
                }
                tag if tag == name!("feComposite") => {
                    let operator = choice(
                        element,
                        name!("operator"),
                        &["over", "in", "out", "atop", "xor", "lighter", "arithmetic"],
                        0,
                    );
                    let factors = [name!("k1"), name!("k2"), name!("k3"), name!("k4")]
                        .map(|it| number(element, it, 0.0));
                    (
                        Primitive::Composite,
                        vec![first, second],
                        [operator as f32].into_iter().chain(factors).collect(),
                    )
                }
                tag if tag == name!("feConvolveMatrix") => convolution(element)
                    .map_or_else(same, |it| (Primitive::ConvolveMatrix, vec![first], it)),
                tag if is_name!(tag, "feDiffuseLighting" | "feSpecularLighting") => {
                    let kinds = [
                        name!("feDistantLight"),
                        name!("fePointLight"),
                        name!("feSpotLight"),
                    ];
                    children()
                        .find_map(|it| Some((it, kinds.iter().position(|kind| *kind == it.tag)?)))
                        .map_or_else(nothing, |(light, kind)| {
                            let point = |names: [Name; 3]| {
                                [0, 1, 2].map(|it| {
                                    number(light, names[it], 0.0) * unit[it]
                                        + origin.get(it).unwrap_or(&0.0)
                                })
                            };
                            let [azimuth, elevation] = [name!("azimuth"), name!("elevation")]
                                .map(|it| number(light, it, 0.0).to_radians());
                            let [x, y, z] = match kind {
                                0 => [
                                    azimuth.cos() * elevation.cos(),
                                    azimuth.sin() * elevation.cos(),
                                    elevation.sin(),
                                ],
                                _ => point([name!("x"), name!("y"), name!("z")]),
                            };
                            let [to_x, to_y, to_z] =
                                point([name!("pointsAtX"), name!("pointsAtY"), name!("pointsAtZ")]);
                            let cone = Some(number(light, name!("limitingConeAngle"), 0.0).abs())
                                .filter(|it| *it > 0.0 && *it < 90.0)
                                .unwrap_or(90.0);
                            let (is_diffuse, [r, g, b, _]) = (
                                tag == name!("feDiffuseLighting"),
                                color(shape.lighting_color, 1.0),
                            );
                            let constant = number(
                                element,
                                if is_diffuse {
                                    name!("diffuseConstant")
                                } else {
                                    name!("specularConstant")
                                },
                                1.0,
                            )
                            .max(0.0);
                            let [exponent, focus] = [element, light].map(|it| {
                                number(it, name!("specularExponent"), 1.0).clamp(1.0, 128.0)
                            });
                            let surface = number(element, name!("surfaceScale"), 1.0) * zoom;
                            let arguments = [
                                surface,
                                constant,
                                exponent,
                                r,
                                g,
                                b,
                                255.0,
                                kind as f32,
                                x,
                                y,
                                z,
                                to_x,
                                to_y,
                                to_z,
                                focus,
                                cone.to_radians().cos(),
                            ];
                            (
                                if is_diffuse {
                                    Primitive::DiffuseLighting
                                } else {
                                    Primitive::SpecularLighting
                                },
                                vec![first],
                                arguments.to_vec(),
                            )
                        })
                }
                tag if tag == name!("feDisplacementMap") && taints(&second) => same(),
                tag if tag == name!("feDisplacementMap") => {
                    let [x, y] = scaled([number(element, name!("scale"), 0.0); 2]);
                    let channel = |name| choice(element, name, &["R", "G", "B", "A"], 3) as f32;
                    (
                        Primitive::DisplacementMap,
                        vec![first, second],
                        vec![
                            x,
                            y,
                            channel(name!("xChannelSelector")),
                            channel(name!("yChannelSelector")),
                        ],
                    )
                }
                tag if tag == name!("feDropShadow") => (
                    Primitive::DropShadow,
                    vec![first],
                    [&offset(2.0)[..], &deviation(2.0), &flood].concat(),
                ),
                tag if tag == name!("feFlood") => (Primitive::Flood, vec![], flood.to_vec()),
                tag if tag == name!("feGaussianBlur") => (
                    Primitive::GaussianBlur,
                    vec![first],
                    deviation(0.0).to_vec(),
                ),
                tag if tag == name!("feImage") => {
                    (Primitive::Image, vec![], vec![inputs.len() as f32])
                }
                tag if tag == name!("feMerge") => {
                    let merged: Vec<_> = children()
                        .filter(|it| it.tag == name!("feMergeNode"))
                        .map(|it| input(it.attribute(name!("in"))))
                        .collect();
                    (Primitive::Merge, merged.clone(), merged)
                }
                tag if tag == name!("feMorphology") => match pair(element, name!("radius"), 0.0) {
                    [x, y] if x < 0.0 || y < 0.0 || x == 0.0 && y == 0.0 => same(),
                    radius => {
                        let dilates =
                            f32::from(element.attribute(name!("operator")) == Some("dilate"));
                        (
                            Primitive::Morphology,
                            vec![first],
                            scaled(radius).into_iter().chain([dilates]).collect(),
                        )
                    }
                },
                tag if tag == name!("feOffset") => {
                    (Primitive::Offset, vec![first], offset(0.0).to_vec())
                }
                tag if tag == name!("feTile") => {
                    let tile = built
                        .get(first as usize)
                        .filter(|_| first >= 0.0)
                        .map_or(region, |it| it.subregion);
                    (
                        Primitive::Tile,
                        vec![first],
                        tile.transformed(&user.matrix).to_array().to_vec(),
                    )
                }
                tag if tag == name!("feTurbulence") => match (
                    pair(element, name!("baseFrequency"), 0.0),
                    number(element, name!("numOctaves"), 1.0).trunc(),
                ) {
                    ([x, y], octaves) if x < 0.0 || y < 0.0 || octaves < 0.0 => nothing(),
                    ([x, y], octaves) => {
                        let stitches =
                            f32::from(element.attribute(name!("stitchTiles")) == Some("stitch"));
                        let is_fractal =
                            f32::from(element.attribute(name!("type")) == Some("fractalNoise"));
                        let seed = number(element, name!("seed"), 0.0).trunc();
                        (
                            Primitive::Turbulence,
                            vec![],
                            vec![
                                x / zoom,
                                y / zoom,
                                octaves.min(9.0),
                                seed,
                                stitches,
                                is_fractal,
                            ],
                        )
                    }
                },
                _ => continue,
            };
            let of_inputs = used
                .iter()
                .map(|it| Some(built.get(*it as usize).filter(|_| *it >= 0.0)?.subregion))
                .reduce(|a, b| Some(a?.union(&b?)));
            let default = of_inputs
                .flatten()
                .filter(|_| kind != Primitive::Tile)
                .unwrap_or(region)
                .to_array();
            let given = [name!("x"), name!("y"), name!("width"), name!("height")]
                .map(|it| element.attribute(it));
            let subregion = Rect::new([0, 1, 2, 3].map(|it| {
                let given = given[it].and_then(|value| {
                    document.length_in_units(&node, value, it, is_relative.then_some(bounds))
                });
                given.unwrap_or(default[it])
            }));
            let uses_current_color = match kind {
                Primitive::Flood | Primitive::DropShadow => shape.flood_color == Color::Current,
                Primitive::DiffuseLighting | Primitive::SpecularLighting => {
                    shape.lighting_color == Color::Current
                }
                Primitive::Image => href(element).is_some_and(|it| document.is_cross_origin(it)),
                _ => false,
            };
            let is_tainted = uses_current_color || used.iter().any(taints);
            let shown = subregion
                .intersection(&region)
                .transformed(&user.matrix)
                .to_array();
            let [first, second] = [0, 1].map(|it| used.get(it).copied().unwrap_or(INPUT_NOTHING));
            let arguments = self.floats([first, second].into_iter().chain(shown).chain(arguments));
            let linear = node.style.svg.filter_interpolation == ColorInterpolation::LinearRgb;
            self.out.filters.push(abi::Filter::Primitive {
                kind,
                linear,
                arguments,
            });
            built.push(Built {
                name: element
                    .attribute(name!("result"))
                    .filter(|it| !it.is_empty()),
                subregion,
                is_tainted,
            });
            inputs.extend((kind == Primitive::Image).then_some(Input {
                primitive: node,
                subregion,
                matrix: user.matrix,
            }));
        }
        *is_tainted = built.last().is_some_and(|it| it.is_tainted);
    }

    pub(crate) fn filter_input(&mut self, input: &Input<'a>, space: &Space) {
        let (document, mut inside) = (input.primitive.document, *space);
        self.marker(Item::Input);
        inside.visible = input.subregion.transformed(&input.matrix);
        self.vector(input.matrix, &mut inside);
        let id = input.primitive.id;
        match href(input.primitive.element).filter(|it| document.fragment_of(it).is_some()) {
            None => self.svg_image(&input.primitive, input.subregion, &inside),
            Some(url) => {
                let Some(target) = document
                    .svg_reference(id, url)
                    .and_then(|it| document.rendered_node(it.id))
                else {
                    return;
                };
                self.vector(
                    translation([input.subregion.x, input.subregion.y]),
                    &mut inside,
                );
                self.with_resource(&input.primitive, |painter| {
                    painter.svg_element(&target, &inside)
                });
            }
        }
    }
}
