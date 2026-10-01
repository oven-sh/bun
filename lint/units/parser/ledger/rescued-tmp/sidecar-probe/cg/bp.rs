#![crate_type = "lib"]
include!("common_priv.rs");
macro_rules! LINT_ITEM_START { ($p:ident, $n:ident) => { let $n = if LINT { $p.latest as u32 } else { 0 }; }; }
macro_rules! ANNOTATION { ($p:ident, $n:ident, $items:ident) => { if LINT { $p.lint_binding_type($n + $items.len() as u32)?; } else { $p.skip_type(0)?; } }; }
macro_rules! RETURN_TYPE { ($p:ident, $loc:ident, $is_arrow:ident) => { if LINT { $is_arrow = $p.lint_arrow_return_type($loc as u32)?; } else { $is_arrow = $p.try_arrow_return_type(); } }; }
impl P {
    #[inline(always)]
    pub fn paren_dispatch(&mut self, loc: i32, level: u8) -> Result<u64, u8> { if self.side.is_some() { self.paren_for_lint(loc, level) } else { self.paren(loc, level) } }
    pub fn paren(&mut self, loc: i32, level: u8) -> Result<u64, u8> { self.paren_impl::<false>(loc, level) }
    #[cold] #[inline(never)]
    pub fn paren_for_lint(&mut self, loc: i32, level: u8) -> Result<u64, u8> { self.paren_impl::<true>(loc, level) }
    #[inline(always)]
    fn paren_impl<const LINT: bool>(&mut self, loc: i32, level: u8) -> Result<u64, u8> {
        include!("body2.rs")
    }
}
