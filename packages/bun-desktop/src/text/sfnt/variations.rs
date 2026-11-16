use super::work::spend;
use super::{Data, Font, Tag};

/// The position on each axis, from -1 to 1 with 14 bits after the point. It is empty for the default instance.
pub type Coords = [i16];

pub struct Axis {
    pub tag: Tag,
    pub min: f32,
    default: f32,
    pub max: f32,
}

pub fn axes(font: &Font) -> Vec<Axis> {
    let read = || {
        let table = font.table(b"fvar")?;
        let (records, size) = (table.at16(4)?, usize::from(table.u16(10)?));
        let axis = |it: Data| {
            Some(Axis {
                tag: it.tag(0)?,
                min: it.fixed(4)?,
                default: it.fixed(8)?,
                max: it.fixed(12)?,
            })
        };
        (0..usize::from(table.u16(8).filter(|it| *it <= 256)?))
            .map(|it| axis(records.from(it * size)?))
            .collect::<Option<Vec<_>>>()
    };
    read().unwrap_or_default()
}

/// The ids of the PostScript names of the named instances.
#[cfg(target_os = "macos")]
pub fn instance_names(font: &Font) -> Vec<u16> {
    let read = || {
        let table = font.table(b"fvar")?;
        let [axes, axis_size, count, size] =
            [8, 10, 12, 14].map(|it| usize::from(table.u16(it).unwrap_or(0)));
        let records = table
            .at16(4)?
            .from(axes * axis_size)
            .filter(|_| size >= axes * 4 + 6)?;
        Some(
            (0..count)
                .filter_map(|it| records.u16(it * size + 4 + axes * 4))
                .filter(|it| *it != 0xffff)
                .collect(),
        )
    };
    read().unwrap_or_default()
}

pub fn normalize(
    font: &Font,
    axes: &[Axis],
    settings: impl Iterator<Item = (Tag, f32)> + Clone,
) -> Vec<i16> {
    let avar = font.table(b"avar");
    let mut map = avar.and_then(|it| it.from(8));
    let coords = axes.iter().enumerate().map(|(index, axis)| {
        let value = settings
            .clone()
            .filter(|it| it.0 == axis.tag)
            .last()
            .map_or(axis.default, |it| it.1);
        let value = value
            .max(axis.min.min(axis.default))
            .min(axis.max.max(axis.default))
            - axis.default;
        let range = if value < 0. {
            axis.default - axis.min
        } else {
            axis.max - axis.default
        };
        let mut value = if value == 0. {
            0.
        } else {
            (f64::from(value) / f64::from(range) * 65536.).round() / 4.
        };
        let has_map = avar
            .and_then(|it| it.u16(6))
            .is_some_and(|it| index < it.into());
        let count = map
            .and_then(|it| it.u16(0))
            .filter(|_| has_map)
            .map_or(0, usize::from);
        let pair = |index: usize| {
            Some([
                f64::from(map?.i16(2 + index * 4)?),
                f64::from(map?.i16(4 + index * 4)?),
            ])
        };
        let after = Data::partition(count, |it| pair(it).is_some_and(|it| it[0] < value));
        if let Some([to, high]) = pair(after).filter(|_| after < count) {
            value = match after.checked_sub(1).and_then(pair) {
                Some([from, low]) => {
                    low + ((high - low) * (value - from) / (to - from) * 4.).round() / 4.
                }
                None => value - to + high,
            };
        }
        map = map.and_then(|it| it.from(if has_map { 2 + count * 4 } else { 0 }));
        (value + 0.5).floor() as i16
    });
    let mut coords: Vec<i16> = coords.collect();
    let cross = avar
        .filter(|it| it.u16(0) == Some(2))
        .zip(map)
        .and_then(|(table, offsets)| {
            let follow = |at: usize| table.from(offsets.u32(at).filter(|it| *it != 0)? as usize);
            Some(Deltas {
                store: follow(4)?,
                map: follow(0),
            })
        });
    if let Some(deltas) = cross {
        let moved = |(axis, it): (u32, &i16)| {
            (f32::from(*it) + deltas.get(axis, &coords).unwrap_or(0.).round())
                .clamp(-16384., 16384.) as i16
        };
        coords = (0..).zip(&coords).map(moved).collect();
    }
    if coords.iter().all(|it| *it == 0) {
        coords.clear();
    }
    coords
}

/// How much of a delta applies along one axis.
pub fn axis_scalar(coord: i16, [start, peak, end]: [i16; 3]) -> f32 {
    let [coord, start, peak, end] = [coord, start, peak, end].map(f32::from);
    if peak == 0. || coord == peak || start > peak || peak > end || start < 0. && end > 0. {
        1.
    } else if coord <= start || coord >= end {
        0.
    } else if coord < peak {
        (coord - start) / (peak - start)
    } else {
        (end - coord) / (end - peak)
    }
}

/// For each region of an item variation data table.
pub fn scalars(store: Data, outer: usize, coords: &Coords) -> Option<impl Iterator<Item = f32>> {
    let (regions, data) = (
        store.at32(2)?,
        store.at32(8 + Some(outer).filter(|it| Some(*it) < store.u16(6).map(usize::from))? * 4)?,
    );
    let axes = usize::from(regions.u16(0).filter(|it| *it <= 256)?);
    let count = usize::from(data.u16(4)?);
    (count * axes <= 1 << 16).then(|| spend(count * (axes + 1)))??;
    Some(data.u16s(6, count).map(move |region| {
        let mut scalar = 1.;
        for axis in 0..axes {
            let at = 4 + (usize::from(region) * axes + axis) * 6;
            scalar *= axis_scalar(
                coords.get(axis).map_or(0, |it| *it),
                [at, at + 2, at + 4].map(|it| regions.i16(it).unwrap_or(0)),
            );
            if scalar == 0. {
                break;
            }
        }
        scalar
    }))
}

pub fn delta(store: Data, outer: usize, inner: usize, coords: &Coords) -> Option<f32> {
    let (scalars, data) = (scalars(store, outer, coords)?, store.at32(8 + outer * 4)?);
    let (items, words, count) = (
        usize::from(data.u16(0)?),
        data.u16(2)?,
        usize::from(data.u16(4)?),
    );
    let (size, words) = (
        if words & 0x8000 != 0 { 2 } else { 1 },
        usize::from(words & 0x7fff),
    );
    let row =
        data.from(6 + count * 2 + Some(inner).filter(|it| *it < items)? * (count + words) * size)?;
    let value = |index: usize| match (index < words, size) {
        (true, 2) => row.u32(index * 4).map(|it| it as i32),
        (true, _) => row.i16(index * 2).map(i32::from),
        (false, 2) => row.i16((index + words) * 2).map(i32::from),
        (false, _) => row.u8(index + words).map(|it| i32::from(it as i8)),
    };
    Some(
        scalars
            .enumerate()
            .filter(|it| it.1 != 0.)
            .map(|(index, scalar)| value(index).unwrap_or(0) as f32 * scalar)
            .sum(),
    )
}

/// An item variation store, and what maps indexes into it.
#[derive(Clone, Copy)]
pub struct Deltas {
    pub store: Data,
    pub map: Option<Data>,
}

impl Deltas {
    pub fn get(&self, index: u32, coords: &Coords) -> Option<f32> {
        let Some(map) = self
            .map
            .filter(|it| it.u32(2) != Some(0) && it.u32(0).is_some_and(|it| it & 0xff00_ffff != 0))
        else {
            return delta(
                self.store,
                index as usize >> 16,
                index as usize & 0xffff,
                coords,
            );
        };
        let (format, (count, start)) = (
            map.u8(1)?,
            if map.u8(0)? == 0 {
                (map.u16(2)?.into(), 4)
            } else {
                (map.u32(2)?, 6)
            },
        );
        let size = usize::from(format >> 4 & 3) + 1;
        let entry = map.part(
            start + index.min(count.checked_sub(1)?) as usize * size,
            size,
        )?;
        let (entry, bits) = (
            entry
                .0
                .iter()
                .fold(0, |all, it| all << 8 | usize::from(*it)),
            (format & 15) + 1,
        );
        delta(self.store, entry >> bits, entry & ((1 << bits) - 1), coords)
    }
}

pub fn metric_delta(font: &Font, tag: &Tag, coords: &Coords) -> f32 {
    let read = || {
        let table = font.table(b"MVAR").filter(|_| !coords.is_empty())?;
        let mut records = (0..usize::from(table.u16(8)?))
            .map(|it| 12 + it * usize::from(table.u16(6).unwrap_or(8)));
        let record = records.find(|it| table.tag(*it) == Some(*tag))?;
        delta(
            table.at16(10)?,
            table.u16(record + 4)?.into(),
            table.u16(record + 6)?.into(),
            coords,
        )
    };
    read().unwrap_or(0.).round()
}
