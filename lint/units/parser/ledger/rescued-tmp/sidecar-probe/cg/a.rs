#![crate_type = "lib"]
include!("common.rs");
macro_rules! LINT_ITEM_START { ($p:ident, $n:ident) => {}; }
macro_rules! ANNOTATION { ($p:ident, $n:ident, $items:ident) => { $p.skip_type(0)?; }; }
macro_rules! RETURN_TYPE { ($p:ident, $loc:ident, $is_arrow:ident) => { $is_arrow = $p.try_arrow_return_type(); }; }
impl P {
    #[inline(always)]
    pub fn paren_dispatch(&mut self, loc: i32, level: u8) -> Result<u64, u8> { self.paren(loc, level) }
    pub fn paren(&mut self, loc: i32, level: u8) -> Result<u64, u8> {
        include!("body2.rs")
    }
}
