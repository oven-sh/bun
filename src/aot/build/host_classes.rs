use rustc_hash::FxHashMap;
use std::sync::OnceLock;

#[derive(Copy, Clone)]
pub(crate) struct CachedGetter {
    pub class: u32,
    pub offset: u32,
}

pub(crate) fn cached_getter(class: &[u8], name: &[u8]) -> Option<CachedGetter> {
    static ROWS: OnceLock<FxHashMap<(&'static [u8], &'static [u8]), CachedGetter>> =
        OnceLock::new();
    let rows = ROWS.get_or_init(|| {
        bun_core::strings::split(include_str!("host-classes.txt").as_bytes(), b"\n")
            .filter_map(|line| {
                let mut columns =
                    bun_core::strings::split(line.strip_suffix(b"\r").unwrap_or(line), b"\t");
                let (class, number, name, offset) = (
                    columns.next()?,
                    columns.next()?,
                    columns.next()?,
                    columns.next()?,
                );
                let offset = std::str::from_utf8(offset)
                    .ok()?
                    .parse()
                    .ok()
                    .filter(|&offset| offset != 0)?;
                Some((
                    (class, name),
                    CachedGetter {
                        class: std::str::from_utf8(number).ok()?.parse().ok()?,
                        offset,
                    },
                ))
            })
            .collect()
    });
    rows.get(&(class, name)).copied()
}
