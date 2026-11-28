//! Joins the arrays of each time zone, so that one lookup finds them.

use crate::codes::to_bytes;
use crate::resb::Res;
use bun_icu_format::zone::{PARTS, parts};

/// `zones` are the items of an array of zoneinfo64.
pub(crate) fn pack(zones: Vec<&mut Res>) {
    for zone in zones {
        let arrays = PARTS.map(|key| match zone.get(key) {
            Some(Res::Ints(numbers)) => numbers.iter().flat_map(|it| it.to_le_bytes()).collect(),
            Some(Res::Binary(bytes)) => bytes.clone(),
            _ => Vec::new(),
        });
        let Res::Table(items) = zone else {
            continue;
        };
        let [sizes @ .., _] = arrays.each_ref().map(|it| it.len() as u16);
        let joined = [to_bytes(&sizes), arrays.concat()].concat();
        assert!(parts(&joined) == arrays);
        items.retain(|it| !PARTS.contains(&it.0));
        items.push((PARTS[4], Res::Binary(joined)));
    }
}
