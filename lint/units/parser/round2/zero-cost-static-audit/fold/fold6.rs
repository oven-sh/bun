#![crate_type = "lib"]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Error { UTF8Fail, OutOfMemory, SyntaxError, UnexpectedSyntax, ParserError, Backtrack }
pub struct Side { pub is_lint: bool, pub n: u64 }
pub struct Lexer { pub token: u8, pub start: usize, pub pad: [u64; 20] }
pub struct P { pub lexer: Lexer, pub allow_in: bool, pub starts: Option<Box<Side>>, pub level: u8 }
extern "Rust" {
    fn lexer_next(l: &mut Lexer) -> Result<(), Error>;
    fn parse_expr(p: &mut P, level: u8) -> Result<u64, Error>;
    fn parse_paren_expr(p: &mut P, loc: usize, level: u8) -> Result<u64, Error>;
}
const _: () = assert!(core::mem::size_of::<Result<(), Error>>() == 1);
impl P {
    #[inline(always)]
    fn err_or_side_table(&self, r: &Result<(), Error>) -> usize {
        // SAFETY: `Result<(), Error>` is one initialized byte (asserted above).
        let raw: u8 = unsafe { core::mem::transmute_copy::<Result<(), Error>, u8>(r) };
        let ok: u8 = unsafe { core::mem::transmute::<Result<(), Error>, u8>(Ok(())) };
        let side = match &self.starts { Some(b) => (&**b) as *const Side as usize, None => 0 };
        (((raw ^ ok) as usize) << 56).wrapping_add(side)
    }
}
#[cold] #[inline(never)]
fn open_paren_slow(p: &mut P, stepped: Result<(), Error>, loc: usize, level: u8) -> Result<u64, Error> {
    stepped?;
    let v = unsafe { parse_paren_expr(p, loc, level)? };
    if let Some(s) = &mut p.starts { s.n += v; }
    Ok(v)
}
#[no_mangle]
pub fn open_paren_base(p: &mut P, level: u8) -> Result<u64, Error> {
    let loc = p.lexer.start;
    unsafe { lexer_next(&mut p.lexer)? };
    if level > 3 { let old = p.allow_in; p.allow_in = true; let v = unsafe { parse_expr(p, 0)? }; p.allow_in = old; return Ok(v); }
    unsafe { parse_paren_expr(p, loc, level) }
}
#[no_mangle]
pub fn open_paren_folded(p: &mut P, level: u8) -> Result<u64, Error> {
    let loc = p.lexer.start;
    let stepped = unsafe { lexer_next(&mut p.lexer) };
    if p.err_or_side_table(&stepped) != 0 { return open_paren_slow(p, stepped, loc, level); }
    if level > 3 { let old = p.allow_in; p.allow_in = true; let v = unsafe { parse_expr(p, 0)? }; p.allow_in = old; return Ok(v); }
    unsafe { parse_paren_expr(p, loc, level) }
}
