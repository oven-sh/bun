//! What the animation elements of SVG do to their targets.

use std::rc::Rc;

use crate::abi::Matrix;
use crate::document::Document;
use crate::geometry::translation;
use crate::name::{Map, Name, is_name, name};
use crate::path::{Numbers, Path, at_distance, mix_paths};
use crate::properties::Prop;
use crate::sheet::Block;
use crate::smil::Progress;
use crate::svg::{Node, href, rotation};
use crate::tree::{Element, Flags, Namespace, NodeId};
use crate::types::*;
use crate::values::*;

#[derive(Default)]
pub(crate) struct Effects {
    /// Of the attributes that are animated, what they are without that.
    pub(crate) bases: Map<(NodeId, Name), (Str, Option<Str>)>,
    pub(crate) styles: Map<NodeId, Rc<Block>>,
    pub(crate) motions: Map<NodeId, Matrix>,
}

impl Effects {
    pub(crate) fn forget(&mut self, id: NodeId) {
        self.bases.retain(|key, _| key.0 != id);
        self.styles.remove(&id);
        self.motions.remove(&id);
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Numbers,
    Integers,
    /// Along the axis.
    Lengths(usize),
    Angle,
    Color,
    Path,
    Text,
    Transform,
}

#[derive(Clone)]
enum Value {
    /// With a unit for all of them.
    Numbers(Vec<f32>, &'static str),
    Path(String),
    Text(String),
}

#[derive(Clone, Copy, PartialEq)]
enum Pace {
    Discrete,
    Linear,
    Paced,
    Spline,
}

fn has_word(list: &str, word: &str) -> bool {
    list.split_ascii_whitespace().any(|it| it == word)
}

/// And whether it is a property that is not an attribute of the DOM.
fn kind_of(target: &Element, name: &str) -> Option<(Kind, bool)> {
    let kinds = [
        (
            Kind::Lengths(0),
            "x x1 x2 cx fx dx rx width refX markerWidth",
        ),
        (
            Kind::Lengths(1),
            "y y1 y2 cy fy dy ry height refY markerHeight",
        ),
        (Kind::Lengths(2), "r fr startOffset textLength"),
        (Kind::Integers, "numOctaves order targetX targetY"),
        (
            Kind::Numbers,
            "amplitude azimuth baseFrequency bias diffuseConstant divisor elevation exponent intercept k1 k2 k3 k4 kernelMatrix \
            kernelUnitLength limitingConeAngle offset pathLength points pointsAtX pointsAtY pointsAtZ radius rotate scale seed slope \
            specularConstant specularExponent stdDeviation surfaceScale tableValues values viewBox z",
        ),
        (Kind::Angle, "orient"),
        (Kind::Path, "d"),
        (
            Kind::Transform,
            "transform gradientTransform patternTransform",
        ),
        (
            Kind::Text,
            "class clipPathUnits edgeMode filterUnits gradientUnits href in in2 lengthAdjust markerUnits maskContentUnits \
            maskUnits method mode operator patternContentUnits patternUnits preserveAlpha preserveAspectRatio primitiveUnits result side \
            spacing spreadMethod stitchTiles target type xChannelSelector yChannelSelector",
        ),
    ];
    if let Some((kind, _)) = kinds.into_iter().find(|it| has_word(it.1, name)) {
        let is_number = matches!(name, "dx" | "dy" | "x" | "y")
            && is_name!(
                target.tag,
                "feOffset" | "feDropShadow" | "fePointLight" | "feSpotLight"
            );
        let is_number =
            is_number && (name.len() == 2 || is_name!(target.tag, "fePointLight" | "feSpotLight"));
        return Some((if is_number { Kind::Numbers } else { kind }, false));
    }
    crate::hints::is_presentation_attribute(target, name).then_some(())?;
    let kinds = [
        (
            Kind::Color,
            "color fill flood-color lighting-color stop-color stroke",
        ),
        (
            Kind::Numbers,
            "fill-opacity flood-opacity opacity stop-opacity stroke-miterlimit stroke-opacity",
        ),
        (
            Kind::Lengths(2),
            "font-size letter-spacing stroke-dasharray stroke-dashoffset stroke-width word-spacing",
        ),
    ];
    Some((
        kinds
            .into_iter()
            .find(|it| has_word(it.1, name))
            .map_or(Kind::Text, |it| it.0),
        true,
    ))
}

fn list(element: &Element, name: Name) -> Option<Vec<&str>> {
    let mut items: Vec<_> = bun_core::strings::split(element.attribute(name)?.as_bytes(), b";")
        .map(|it| text(it.trim_ascii()))
        .collect();
    items.pop_if(|it| it.is_empty());
    Some(items)
}

fn fractions(element: &Element, name: Name) -> Option<Vec<f32>> {
    list(element, name)?
        .iter()
        .map(|it| it.parse().ok().filter(|it| (0.0..=1.0).contains(it)))
        .collect()
}

impl Value {
    /// `None` if they do not go together.
    fn sum(&self, of_self: f32, other: &Value, of_other: f32) -> Option<Value> {
        match (self, other) {
            (Value::Numbers(a, unit), Value::Numbers(b, other_unit))
                if a.len() == b.len() && unit == other_unit =>
            {
                Some(Value::Numbers(
                    a.iter()
                        .zip(b)
                        .map(|(a, b)| a * of_self + b * of_other)
                        .collect(),
                    unit,
                ))
            }
            (Value::Path(a), Value::Path(b)) => mix_paths(a, b, of_self, of_other).map(Value::Path),
            _ => None,
        }
    }

    fn distance(&self, other: &Value) -> Option<f32> {
        let Value::Numbers(difference, _) = self.sum(1.0, other, -1.0)? else {
            return None;
        };
        Some(difference.iter().map(|it| it * it).sum::<f32>().sqrt())
    }

    fn write(&self, kind: Kind) -> String {
        match (self, kind) {
            (Value::Path(it) | Value::Text(it), _) => it.clone(),
            (Value::Numbers(it, _), Kind::Color) => format!(
                "rgba({},{},{},{})",
                it[0].round(),
                it[1].round(),
                it[2].round(),
                it[3] / 255.0
            ),
            (Value::Numbers(it, unit), _) => {
                let words = it.iter().map(|it| {
                    format!(
                        "{}{unit}",
                        if kind == Kind::Integers {
                            it.round()
                        } else {
                            *it
                        }
                    )
                });
                words.collect::<Vec<_>>().join(" ")
            }
        }
    }
}

/// Between which two of so many values the animation is, and how far. `None` if it is in error.
fn locate(
    element: &Element,
    pace: Pace,
    count: usize,
    distances: impl FnOnce() -> Option<Vec<f32>>,
    fraction: f32,
) -> Option<(usize, f32)> {
    let mut times = match (pace, element.has(name!("keyTimes"))) {
        (Pace::Paced, _) => {
            distances()
                .filter(|it| it.iter().sum::<f32>() > 0.0)
                .map(|distances| {
                    let total: f32 = distances.iter().sum();
                    core::iter::once(0.0)
                        .chain(distances.iter().scan(0.0, |sum, it| {
                            *sum += it;
                            Some(*sum / total)
                        }))
                        .collect()
                })
        }
        (_, true) => fractions(element, name!("keyTimes"))
            .filter(|it| it.first() == Some(&0.0) && it.is_sorted()),
        (_, false) => None,
    };
    if times.as_ref().is_some_and(|it| {
        it.len() != count || pace != Pace::Discrete && it.last().is_some_and(|it| *it < 0.9999)
    }) {
        return None;
    }
    let steps = if pace == Pace::Discrete {
        count
    } else {
        count.saturating_sub(1).max(1)
    };
    let times =
        times.get_or_insert_with(|| (0..count).map(|it| it as f32 / steps as f32).collect());
    let splines = (pace == Pace::Spline).then(|| {
        list(element, name!("keySplines"))?
            .iter()
            .map(|it| Numbers::all(it)?.try_into().ok())
            .collect::<Option<Vec<[f32; 4]>>>()
    });
    if splines.as_ref().is_some_and(|it| {
        !it.as_ref().is_some_and(|it| {
            it.len() + 1 == count && it.as_flattened().iter().all(|it| (0.0..=1.0).contains(it))
        })
    }) {
        return None;
    }
    let index = times
        .partition_point(|it| *it <= fraction)
        .saturating_sub(1);
    if pace == Pace::Discrete || index + 1 >= count {
        return Some((index, 0.0));
    }
    let between = (fraction - times[index]) / (times[index + 1] - times[index]);
    Some((
        index,
        splines.flatten().map_or(between, |it| {
            Easing::Bezier(it[index].map(f64::from), "").apply(between.into(), false) as f32
        }),
    ))
}

struct Plan<T> {
    values: Vec<T>,
    adds: bool,
    accumulates: bool,
}

/// `underlying` is for an animation that only says where to go.
fn plan<T>(
    element: &Element,
    parse: impl Fn(&str) -> Option<T>,
    add: impl Fn(&T, f32, &T) -> Option<T>,
    underlying: impl FnOnce() -> Option<T>,
) -> Option<Plan<T>> {
    let get = |name| {
        element
            .attribute(name)
            .filter(|it| !it.is_empty() || element.attribute(name!("attributeName")) == Some("d"))
    };
    let (adds, accumulates) = (
        get(name!("additive")) == Some("sum"),
        get(name!("accumulate")) == Some("sum"),
    );
    if element.tag == name!("set") {
        return Some(Plan {
            values: vec![parse(element.attribute(name!("to"))?)?],
            adds: false,
            accumulates: false,
        });
    }
    Some(
        match (
            list(element, name!("values")),
            get(name!("from")),
            get(name!("to")),
            get(name!("by")),
        ) {
            (Some(values), ..) => Plan {
                values: Some(
                    values
                        .iter()
                        .map(|it| parse(it))
                        .collect::<Option<Vec<_>>>()?,
                )
                .filter(|it| !it.is_empty())?,
                adds,
                accumulates,
            },
            (_, Some(from), Some(to), _) => Plan {
                values: vec![parse(from)?, parse(to)?],
                adds,
                accumulates,
            },
            (_, None, Some(to), _) => Plan {
                values: vec![underlying()?, parse(to)?],
                adds: false,
                accumulates: false,
            },
            (_, Some(from), _, Some(by)) => Plan {
                values: vec![parse(from)?, add(&parse(from)?, 1.0, &parse(by)?)?],
                adds,
                accumulates,
            },
            (_, None, _, Some(by)) => Plan {
                values: vec![add(&parse(by)?, -1.0, &parse(by)?)?, parse(by)?],
                adds: true,
                accumulates,
            },
            _ => return None,
        },
    )
}

fn pace(element: &Element) -> Pace {
    match element.attribute(name!("calcMode")) {
        Some("discrete") => Pace::Discrete,
        Some("linear") => Pace::Linear,
        Some("paced") => Pace::Paced,
        Some("spline") => Pace::Spline,
        _ => {
            if element.tag == name!("animateMotion") {
                Pace::Paced
            } else {
                Pace::Linear
            }
        }
    }
}

impl Document {
    pub(crate) fn smil_target(&self, id: NodeId) -> Option<NodeId> {
        let target = match href(self.tree.element(id)?).filter(|it| !it.is_empty()) {
            Some(url) => self.svg_element_by_id(id, self.fragment_of(url)?)?,
            None => self.tree[id].parent,
        };
        self.tree
            .element(target)
            .filter(|it| it.namespace == Namespace::Svg)
            .map(|_| target)
    }

    /// Without what SMIL has done to it.
    fn property_text(&mut self, id: NodeId, name: &str) -> Option<String> {
        let own = self.smil.effects.styles.remove(&id);
        let parent = self
            .style_on_demand(self.tree.flat_parent(id))
            .unwrap_or_else(|| Rc::clone(&self.styles.initial));
        let style = self.compute_style(id, &self.match_rules(id, None, false), &parent);
        self.smil.effects.styles.extend(own.map(|it| (id, it)));
        let (mut out, property) = (
            Out::new(),
            *Prop::from_name(name.as_bytes())?
                .longhands(style.flow())
                .first()?,
        );
        with_zoom(style.zoom, || style.get(property).write(&mut out));
        Some(text(&out).to_owned())
    }

    fn parse_animated(
        &self,
        target: &Node,
        name: &str,
        kind: Kind,
        keeps_units: bool,
        source: &str,
    ) -> Option<Value> {
        let words = || bun_core::strings::tokenize_any(source.as_bytes(), b", \t\r\n").map(text);
        let value = match kind {
            Kind::Numbers | Kind::Integers => Numbers::all(source).map(|mut numbers| {
                if numbers.len() == 1
                    && has_word(
                        "baseFrequency kernelUnitLength order radius stdDeviation",
                        name,
                    )
                {
                    numbers.push(numbers[0]);
                }
                Value::Numbers(numbers, "")
            }),
            Kind::Lengths(axis) => words()
                .map(|it| self.parse_svg_length(target, it))
                .collect::<Option<Vec<_>>>()
                .map(|lengths| {
                    let fraction = |it: &Lp| {
                        if let Lp::Fraction(it) = it {
                            Some(it * 100.0)
                        } else {
                            None
                        }
                    };
                    let percentages = lengths
                        .iter()
                        .map(fraction)
                        .collect::<Option<Vec<_>>>()
                        .filter(|it| keeps_units && !it.is_empty());
                    percentages.map_or_else(
                        || {
                            Value::Numbers(
                                lengths.iter().map(|it| target.resolve(it, axis)).collect(),
                                "",
                            )
                        },
                        |it| Value::Numbers(it, "%"),
                    )
                }),
            Kind::Angle => Numbers::all(source)
                .filter(|it| it.len() == 1)
                .or_else(|| {
                    Some(vec![parse_all(source.as_bytes(), |p| {
                        degrees(p, &Ctx::dummy())
                    })?])
                })
                .map(|it| Value::Numbers(it, "")),
            Kind::Color => {
                parse_all(source.as_bytes(), |p| Color::parse(p, &Ctx::dummy())).map(|it| {
                    Value::Numbers(
                        it.resolve(target.style.color())
                            .to_be_bytes()
                            .map(f32::from)
                            .to_vec(),
                        "",
                    )
                })
            }
            Kind::Path => crate::path::normalize(source).map(|_| Value::Path(source.to_owned())),
            Kind::Text | Kind::Transform => None,
        };
        let may_be_text = matches!(kind, Kind::Text | Kind::Color)
            || kind == Kind::Angle && source.starts_with("auto")
            || has_word(
                "font-size stroke-dasharray letter-spacing word-spacing",
                name,
            );
        value.or_else(|| may_be_text.then(|| Value::Text(source.to_owned())))
    }

    fn animate_value(
        &self,
        element: &Element,
        progress: &Progress,
        target: &Node,
        name: &str,
        kind: Kind,
        underlying: &str,
        inherited: Option<&str>,
    ) -> Option<String> {
        let sources = [name!("values"), name!("from"), name!("to"), name!("by")]
            .into_iter()
            .filter_map(|it| element.attribute(it));
        let keeps_units = sources
            .flat_map(|it| bun_core::strings::tokenize_any(it.as_bytes(), b",; \t\r\n"))
            .all(|it| it.ends_with(b"%"));
        let parse = |it: &str| {
            self.parse_animated(
                target,
                name,
                kind,
                keeps_units,
                inherited.filter(|_| it == "inherit").unwrap_or(it),
            )
        };
        let base =
            || parse(underlying).filter(|it| !matches!(it, Value::Numbers(it, _) if it.is_empty()));
        let zero = || {
            element
                .attribute(name!("to"))
                .and_then(parse)
                .and_then(|it| it.sum(0.0, &it, 0.0).or(Some(it)))
        };
        let Plan {
            values,
            adds,
            accumulates,
        } = plan(
            element,
            parse,
            |a, by, b| b.sum(by, a, 1.0),
            || base().or_else(zero),
        )?;
        let pace = if kind == Kind::Text && pace(element) != Pace::Spline {
            Pace::Discrete
        } else {
            pace(element)
        };
        let (index, between) = locate(
            element,
            pace,
            values.len(),
            || {
                values
                    .iter()
                    .zip(&values[1..])
                    .map(|(a, b)| a.distance(b))
                    .collect()
            },
            progress.fraction,
        )?;
        let mut value = match values.get(index + 1).filter(|_| between > 0.0) {
            Some(next) => values[index]
                .sum(1.0 - between, next, between)
                .unwrap_or_else(|| values[index + usize::from(between >= 0.5)].clone()),
            None => values[index].clone(),
        };
        if accumulates && progress.iteration > 0 {
            value = value
                .sum(1.0, values.last()?, progress.iteration as f32)
                .unwrap_or(value);
        }
        if matches!(&value, Value::Path(it) if it.is_empty())
            && (adds
                || element.has(name!("by"))
                    && !element.has(name!("to"))
                    && !element.has(name!("values")))
        {
            return None;
        }
        if let Some(base) = base().filter(|_| adds) {
            let needs_base =
                kind == Kind::Path && !element.has(name!("values")) && !element.has(name!("from"));
            value = value
                .sum(1.0, &base, 1.0)
                .or_else(|| (!needs_base).then_some(value))?;
        }
        Some(value.write(kind))
    }

    fn animate_transform(
        element: &Element,
        progress: &Progress,
        underlying: &str,
    ) -> Option<String> {
        let function = element.attribute(name!("type")).unwrap_or("translate");
        let parse = |it: &str| {
            Some(Value::Numbers(
                match (function, &Numbers::all(it)?[..]) {
                    ("translate", [x]) => vec![*x, 0.0],
                    ("scale", [x]) => vec![*x, *x],
                    ("rotate", [angle]) => vec![*angle, 0.0, 0.0],
                    ("translate" | "scale", all @ [_, _])
                    | ("rotate", all @ [_, _, _])
                    | ("skewX" | "skewY", all @ [_]) => all.to_vec(),
                    _ => return None,
                },
                "",
            ))
        };
        let base = || {
            let own = underlying
                .trim_ascii()
                .strip_prefix(function)
                .and_then(|it| parse(it.trim_ascii().strip_prefix('(')?.strip_suffix(')')?));
            own.or_else(|| parse("0"))
        };
        let Plan {
            values,
            adds,
            accumulates,
        } = plan(element, parse, |a, by, b| b.sum(by, a, 1.0), base)?;
        let (index, between) = locate(
            element,
            pace(element),
            values.len(),
            || {
                values
                    .iter()
                    .zip(&values[1..])
                    .map(|(a, b)| a.distance(b))
                    .collect()
            },
            progress.fraction,
        )?;
        let value = values[index].sum(
            1.0 - between,
            values.get(index + 1).unwrap_or(&values[index]),
            between,
        )?;
        let value = value.sum(
            1.0,
            values.last()?,
            if accumulates {
                progress.iteration as f32
            } else {
                0.0
            },
        )?;
        Some(format!(
            "{} {function}({})",
            if adds { underlying } else { "" },
            value.write(Kind::Numbers)
        ))
    }

    fn animate_motion(
        &self,
        element: &Element,
        progress: &Progress,
        underlying: &Matrix,
    ) -> Option<Matrix> {
        let is_path = |it: &NodeId| {
            self.tree
                .element(*it)
                .is_some_and(|it| it.tag == name!("mpath"))
        };
        let referenced = self
            .tree
            .element_children(progress.id)
            .find(is_path)
            .and_then(|it| self.svg_reference(it, href(self.tree.element(it)?)?));
        let given = referenced
            .and_then(|it| self.svg_path(&it))
            .or_else(|| element.attribute(name!("path")).map(Path::parse))
            .filter(|it| !it.verbs.is_empty());
        let point = |it: &str| <[f32; 2]>::try_from(Numbers::all(it)?).ok();
        let points = || {
            plan(
                element,
                point,
                |a, by, b| Some([a[0] + b[0] * by, a[1] + b[1] * by]),
                || Some([underlying[4], underlying[5]]),
            )
        };
        let (
            path,
            Plan {
                values,
                adds,
                accumulates,
            },
        ) = match given {
            Some(path) => (
                path,
                Plan {
                    values: Vec::new(),
                    adds: element.attribute(name!("additive")) == Some("sum"),
                    accumulates: element.attribute(name!("accumulate")) == Some("sum"),
                },
            ),
            None => points().map(|it| (Path::polygon(it.values.iter().copied(), false), it))?,
        };
        let (pieces, length, has_points) = (
            path.pieces(),
            path.length(),
            element.has(name!("keyPoints")),
        );
        let pace = Some(pace(element))
            .filter(|it| !has_points || *it != Pace::Paced)
            .unwrap_or(Pace::Linear);
        let stops = match (has_points, values.is_empty()) {
            (true, _) => fractions(element, name!("keyPoints"))
                .filter(|it| it.len() > 1 && element.has(name!("keyTimes")))?,
            (false, true) if pace == Pace::Discrete => path
                .distances()
                .into_iter()
                .map(|it| it / length.max(1e-9))
                .collect(),
            (false, true) => vec![0.0, 1.0],
            (false, false) => core::iter::once(0.0)
                .chain(pieces.iter().scan(0.0, |sum, it| {
                    *sum += it.length();
                    Some(*sum / length.max(1e-9))
                }))
                .collect(),
        };
        let (index, between) = locate(
            element,
            pace,
            stops.len(),
            || Some(stops.iter().zip(&stops[1..]).map(|(a, b)| b - a).collect()),
            progress.fraction,
        )?;
        let along = mix(
            stops[index],
            *stops.get(index + 1).unwrap_or(&stops[index]),
            between,
        );
        let ([x, y], radians) =
            at_distance(&pieces, along * length).or_else(|| Some((path.start()?, 0.0)))?;
        let (end, cycles) = (
            pieces.last().map_or([x, y], |it| it.to),
            if accumulates {
                progress.iteration as f32
            } else {
                0.0
            },
        );
        let radians = match element.attribute(name!("rotate")) {
            Some("auto") => radians,
            Some("auto-reverse") => radians + core::f32::consts::PI,
            angle => angle
                .and_then(|it| it.trim_ascii().parse::<f32>().ok())
                .unwrap_or(0.0)
                .to_radians(),
        };
        let own = multiply(
            &translation([x + end[0] * cycles, y + end[1] * cycles]),
            &rotation(radians),
        );
        Some(if adds {
            multiply(underlying, &own)
        } else {
            own
        })
    }

    /// By ascending priority.
    pub(crate) fn apply_smil(&mut self, contributing: impl Iterator<Item = Progress>) {
        let (mut values, mut motions) = (
            Vec::<(NodeId, Str, bool, String)>::new(),
            Map::<NodeId, Matrix>::default(),
        );
        for progress in contributing {
            let Some((target, element)) = self
                .smil_target(progress.id)
                .zip(self.tree.element(progress.id))
            else {
                continue;
            };
            if !core::iter::once(progress.id)
                .chain(self.tree.flat_ancestors(progress.id))
                .filter_map(|it| self.tree.element(it))
                .all(crate::svg::passes_tests)
            {
                continue;
            }
            if element.tag == name!("animateMotion") {
                let underlying = motions.get(&target).copied().unwrap_or(IDENTITY);
                motions.extend(
                    self.animate_motion(element, &progress, &underlying)
                        .map(|it| (target, it)),
                );
                continue;
            }
            let name: Str = element
                .attribute(name!("attributeName"))
                .map(|it| if it == "xlink:href" { "href" } else { it })
                .unwrap_or_default()
                .into();
            let Some((kind, is_property)) =
                self.tree.element(target).and_then(|it| kind_of(it, &name))
            else {
                continue;
            };
            if (kind == Kind::Transform) != (element.tag == name!("animateTransform"))
                || &*name == "href"
                    && is_name!(
                        self.tree.element(target).map_or(Name::NONE, |it| it.tag),
                        "script"
                    )
            {
                continue;
            }
            let (known, key) = (
                values
                    .iter()
                    .position(|it| (it.0, &it.1) == (target, &name)),
                Name::new(name.as_bytes()),
            );
            let underlying = match (known, self.smil.effects.bases.get(&(target, key))) {
                (Some(known), _) => values[known].3.clone(),
                _ if is_property => self.property_text(target, &name).unwrap_or_default(),
                (_, Some(base)) => base.1.as_deref().unwrap_or_default().to_owned(),
                _ => self
                    .tree
                    .element(target)
                    .and_then(|it| it.attribute(key))
                    .unwrap_or_default()
                    .to_owned(),
            };
            let inherited = if is_property {
                self.property_text(self.tree.flat_parent(target), &name)
            } else {
                None
            };
            let (Some(element), Some(node)) =
                (self.tree.element(progress.id), self.svg_node(target))
            else {
                continue;
            };
            let value = match kind {
                Kind::Transform => Document::animate_transform(element, &progress, &underlying),
                _ => self.animate_value(
                    element,
                    &progress,
                    &node,
                    &name,
                    kind,
                    &underlying,
                    inherited.as_deref(),
                ),
            };
            match (value, known) {
                (Some(value), Some(known)) => values[known].3 = value,
                (value, _) => values.extend(value.map(|it| (target, name, is_property, it))),
            }
        }
        let is_over = |key: &(NodeId, Name)| {
            !values
                .iter()
                .any(|it| !it.2 && (it.0, Name::new(it.1.as_bytes())) == *key)
        };
        let over: Vec<_> = self
            .smil
            .effects
            .bases
            .extract_if(|key, _| is_over(key))
            .collect();
        over.into_iter().for_each(|((target, _), (name, base))| {
            self.set_attribute(target, &name, base.as_deref())
        });
        let mut sources = Map::<NodeId, String>::default();
        for (target, name, is_property, value) in values {
            if is_property {
                let is_bare = matches!(&*name, "font-size" | "letter-spacing" | "word-spacing")
                    && value.parse::<f32>().is_ok();
                sources.entry(target).or_default().push_str(&format!(
                    "{name}:{value}{};",
                    if is_bare { "px" } else { "" }
                ));
                continue;
            }
            let key = Name::new(name.as_bytes());
            let current = self
                .tree
                .element(target)
                .and_then(|it| it.attribute(key))
                .map(Str::from);
            self.smil
                .effects
                .bases
                .entry((target, key))
                .or_insert_with(|| (Rc::clone(&name), current));
            self.set_attribute(target, &name, Some(&value));
        }
        let styles: Map<_, _> = sources
            .iter()
            .filter_map(|(id, source)| {
                Some((
                    *id,
                    self.styles
                        .block(source.as_bytes(), Default::default(), &self.base_url)?,
                ))
            })
            .collect();
        let old = core::mem::replace(&mut self.smil.effects.styles, styles);
        let new = &self.smil.effects.styles;
        let restyled: Vec<_> = old
            .keys()
            .chain(new.keys())
            .copied()
            .filter(|it| old.get(it).map(Rc::as_ptr) != new.get(it).map(Rc::as_ptr))
            .collect();
        for id in restyled {
            self.tree.mark_style(id, Flags::REMATCH);
            if self.tree.style(id).is_none() {
                self.svg_changed(id);
            }
        }
        let old = core::mem::replace(&mut self.smil.effects.motions, motions);
        let moved: Vec<_> = old
            .keys()
            .chain(self.smil.effects.motions.keys())
            .copied()
            .filter(|it| old.get(it) != self.smil.effects.motions.get(it))
            .collect();
        for it in moved {
            self.svg_changed(it);
        }
    }
}
