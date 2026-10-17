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
        include_str!("host-classes.txt")
            .lines()
            .filter_map(|line| {
                let mut columns = line.split('\t');
                let (class, number, name, offset) = (
                    columns.next()?,
                    columns.next()?,
                    columns.next()?,
                    columns.next()?,
                );
                let offset = offset.parse().ok().filter(|&offset| offset != 0)?;
                Some((
                    (class.as_bytes(), name.as_bytes()),
                    CachedGetter {
                        class: number.parse().ok()?,
                        offset,
                    },
                ))
            })
            .collect()
    });
    rows.get(&(class, name)).copied()
}
