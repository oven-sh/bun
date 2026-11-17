//! https://html.spec.whatwg.org/#image-map-processing-model

use bun_core::strings;

use super::prelude::*;
use crate::api::forms::microsyntax::parse_float;

fn map_of(image: &Element) -> Option<&Element> {
    let name = image.with_attr(atom!("usemap"), |it| {
        Some(strings::split_once_char(it.as_bytes(), b'#')?.1.to_vec())
    })??;
    let is_named = |it: &Element, by| it.with_attr(by, |it| it.as_bytes() == name) == Some(true);
    let mut maps = image
        .root()
        .descendant_elements()
        .filter(|it| !name.is_empty() && it.is_html(atom!("map")));
    maps.find(|it| is_named(it, atom!("id")) || is_named(it, atom!("name")))
}

fn contains(area: &Element, [x, y]: [f64; 2]) -> bool {
    let number = |text: &[u8]| {
        parse_float(&text[strings::index_of_any(text, b"0123456789.-").unwrap_or(text.len())..])
            .unwrap_or(0.0)
    };
    let coords = area.with_attr(atom!("coords"), |it| {
        strings::tokenize_any(it.as_bytes(), b"\t\n\x0c\r ,;")
            .map(number)
            .collect::<Vec<_>>()
    });
    match (
        area.keyword(atom!("shape")),
        &coords.unwrap_or_default()[..],
    ) {
        (Some(atom!("default")), _) => true,
        (Some(atom!("circle") | atom!("circ")), coords) => {
            matches!(*coords, [cx, cy, r, ..] if r > 0.0 && (x - cx).hypot(y - cy) <= r)
        }
        (Some(atom!("poly") | atom!("polygon")), coords) => {
            let points = coords.as_chunks::<2>().0;
            let edges = points.iter().zip(points.iter().cycle().skip(1));
            let is_on = |([x1, y1], [x2, y2]): (&[f64; 2], &[f64; 2])| {
                (x2 - x1) * (y - y1) == (y2 - y1) * (x - x1)
                    && (x - x1) * (x - x2) <= 0.0
                    && (y - y1) * (y - y2) <= 0.0
            };
            let crossed = edges.clone().filter(|([x1, y1], [x2, y2])| {
                (*y1 > y) != (*y2 > y) && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1
            });
            points.len() >= 3 && (crossed.count() % 2 == 1 || edges.into_iter().any(is_on))
        }
        (_, &[x1, y1, x2, y2, ..]) => {
            x >= x1.min(x2) && x < x1.max(x2) && y >= y1.min(y2) && y < y1.max(y2)
        }
        _ => false,
    }
}

pub(crate) fn area_at<'a>(
    cx: &mut Cx<'a>,
    image: &'a Element,
    point: [f64; 2],
) -> Option<&'a Element> {
    let map = map_of(image)?;
    let [x, y] = layout::offset_in(cx, image, point);
    let [left, top, ..] = image.engine(|engine, id| engine.box_sizes(id));
    let point = [x - f64::from(left), y - f64::from(top)];
    map.descendant_elements()
        .find(|it| it.is_html(atom!("area")) && contains(it, point))
}

pub(crate) fn image_of(area: &Element) -> Option<&Element> {
    let map = area.closest_html(atom!("map"))?;
    area.root()
        .elements_with_objects()
        .find(|it| it.is_html(atom!("img")) && map_of(it) == Some(map))
}
