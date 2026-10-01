#![crate_type = "lib"]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Error { UTF8Fail, OutOfMemory, SyntaxError, UnexpectedSyntax, ParserError, Backtrack }
pub struct Side { pub is_lint: bool, pub n: u64 }
pub struct Lexer { pub token: u8, pub start: usize, pub pad: [u64; 20] }
pub struct P { pub lexer: Lexer, pub allow_in: bool, pub starts: Option<Box<Side>>, pub level: u8 }
extern "Rust" {
    fn lexer_next(l: &mut Lexer) -> Result<(), Error>;
    fn skip_type(p: &mut P) -> Result<(), Error>;
    fn lint_annotation(p: &mut P, loc: usize) -> Result<(), Error>;
    fn parse_stmt(p: &mut P) -> Result<(u64, u64), Error>;
    fn record(p: &mut P, a: u64);
    fn push(p: &mut P, a: u64, b: u64);
}
impl P {
    #[inline(always)]
    fn lint_word(&self) -> usize { match &self.starts { Some(b) => (&**b) as *const Side as usize, None => 0 } }
    // One word that is zero only for `Ok(())` of a parse without a side table.
    #[inline(always)]
    fn err_or_lint(&self, r: &Result<(), Error>) -> usize {
        let raw: u8 = unsafe { core::mem::transmute_copy::<Result<(), Error>, u8>(r) };
        let ok: u8 = unsafe { core::mem::transmute::<Result<(), Error>, u8>(Ok(())) };
        (((raw ^ ok) as usize) << 56).wrapping_add(self.lint_word())
    }
}
#[cold] #[inline(never)]
fn annotation_slow(p: &mut P, stepped: Result<(), Error>, loc: usize) -> Result<(), Error> { stepped?; unsafe { lint_annotation(p, loc) } }
#[no_mangle]
pub fn annotation_shift(p: &mut P, loc: usize) -> Result<(), Error> {
    if p.lexer.token == 7 {
        let stepped = unsafe { lexer_next(&mut p.lexer) };
        if p.err_or_lint(&stepped) != 0 { return annotation_slow(p, stepped, loc); }
        unsafe { skip_type(p)?; }
    }
    Ok(())
}
#[no_mangle]
pub fn annotation_base(p: &mut P, _loc: usize) -> Result<(), Error> {
    if p.lexer.token == 7 { unsafe { lexer_next(&mut p.lexer)?; skip_type(p)?; } }
    Ok(())
}
