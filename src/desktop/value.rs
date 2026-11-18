pub(crate) use bun_ui::data::*;

macro_rules! record {
    ($($members:tt)*) => { bun_ui::record!($($members)*) };
}

macro_rules! list {
    ($($items:tt)*) => { bun_ui::list!($($items)*) };
}
