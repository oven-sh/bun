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
}
impl P {
    #[inline(always)]
    fn lint_word(&self) -> usize { match &self.starts { Some(b) => (&**b) as *const Side as usize, None => 0 } }
}
#[cold] #[inline(never)]
fn annotation_slow(p: &mut P, stepped: Result<(), Error>, loc: usize) -> Result<(), Error> { stepped?; unsafe { lint_annotation(p, loc) } }
// A: black_box on the combined word
#[no_mangle]
pub fn annotation_bb(p: &mut P, loc: usize) -> Result<(), Error> {
    if p.lexer.token == 7 {
        let stepped = unsafe { lexer_next(&mut p.lexer) };
        let w = core::hint::black_box(stepped.is_err() as usize | p.lint_word());
        if w != 0 { return annotation_slow(p, stepped, loc); }
        unsafe { skip_type(p)?; }
    }
    Ok(())
}
// B: select_unpredictable
#[no_mangle]
pub fn annotation_sel(p: &mut P, loc: usize) -> Result<(), Error> {
    if p.lexer.token == 7 {
        let stepped = unsafe { lexer_next(&mut p.lexer) };
        let w = core::hint::select_unpredictable(stepped.is_err(), 1usize, p.lint_word());
        if w != 0 { return annotation_slow(p, stepped, loc); }
        unsafe { skip_type(p)?; }
    }
    Ok(())
}
// C: the word is added to the raw discriminant byte and compared with the Ok pattern once
#[no_mangle]
pub fn annotation_sum(p: &mut P, loc: usize) -> Result<(), Error> {
    if p.lexer.token == 7 {
        let stepped = unsafe { lexer_next(&mut p.lexer) };
        let raw: u8 = unsafe { core::mem::transmute::<Result<(), Error>, u8>(stepped) };
        let ok: u8 = unsafe { core::mem::transmute::<Result<(), Error>, u8>(Ok(())) };
        let w = ((raw ^ ok) as usize).wrapping_mul(0x9E37_79B9_7F4A_7C15).wrapping_add(p.lint_word());
        if w != 0 { return annotation_slow(p, stepped, loc); }
        unsafe { skip_type(p)?; }
    }
    Ok(())
}
