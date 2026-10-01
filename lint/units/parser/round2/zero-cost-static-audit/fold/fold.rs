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
    fn skip_type(p: &mut P) -> Result<(), Error>;
    fn lint_annotation(p: &mut P, loc: usize) -> Result<(), Error>;
}
impl P {
    #[inline(always)]
    fn lint_word(&self) -> usize {
        match &self.starts { Some(b) => (&**b) as *const Side as usize, None => 0 }
    }
}
#[cold] #[inline(never)]
fn open_paren_slow(p: &mut P, stepped: Result<(), Error>, loc: usize, level: u8) -> Result<u64, Error> {
    stepped?;
    let v = unsafe { parse_paren_expr(p, loc, level)? };
    if let Some(s) = &mut p.starts { s.n += v; }
    Ok(v)
}
// base shape: `next()?` then the existing level test
#[no_mangle]
pub fn open_paren_base(p: &mut P, level: u8) -> Result<u64, Error> {
    let loc = p.lexer.start;
    unsafe { lexer_next(&mut p.lexer)? };
    if level > 3 {
        let old = p.allow_in; p.allow_in = true;
        let v = unsafe { parse_expr(p, 0)? };
        p.allow_in = old;
        return Ok(v);
    }
    unsafe { parse_paren_expr(p, loc, level) }
}
// merged shape at HEAD: a test of its own after the `?`
#[no_mangle]
pub fn open_paren_own_test(p: &mut P, level: u8) -> Result<u64, Error> {
    let loc = p.lexer.start;
    unsafe { lexer_next(&mut p.lexer)? };
    if matches!(&p.starts, Some(s) if s.is_lint) { return open_paren_slow(p, Ok(()), loc, level); }
    if level > 3 {
        let old = p.allow_in; p.allow_in = true;
        let v = unsafe { parse_expr(p, 0)? };
        p.allow_in = old;
        return Ok(v);
    }
    unsafe { parse_paren_expr(p, loc, level) }
}
// folded: the side-table word is OR-ed into the error test of `next()`
#[no_mangle]
pub fn open_paren_folded(p: &mut P, level: u8) -> Result<u64, Error> {
    let loc = p.lexer.start;
    let stepped = unsafe { lexer_next(&mut p.lexer) };
    if (stepped.is_err() as usize | p.lint_word()) != 0 { return open_paren_slow(p, stepped, loc, level); }
    if level > 3 {
        let old = p.allow_in; p.allow_in = true;
        let v = unsafe { parse_expr(p, 0)? };
        p.allow_in = old;
        return Ok(v);
    }
    unsafe { parse_paren_expr(p, loc, level) }
}
#[cold] #[inline(never)]
fn annotation_slow(p: &mut P, stepped: Result<(), Error>, loc: usize) -> Result<(), Error> {
    stepped?;
    unsafe { lint_annotation(p, loc) }
}
#[no_mangle]
pub fn annotation_base(p: &mut P, _loc: usize) -> Result<(), Error> {
    if p.lexer.token == 7 { unsafe { lexer_next(&mut p.lexer)?; skip_type(p)?; } }
    Ok(())
}
#[no_mangle]
pub fn annotation_own_test(p: &mut P, loc: usize) -> Result<(), Error> {
    if p.lexer.token == 7 { unsafe { lexer_next(&mut p.lexer)?; if p.starts.is_some() { lint_annotation(p, loc)?; } else { skip_type(p)?; } } }
    Ok(())
}
#[no_mangle]
pub fn annotation_folded(p: &mut P, loc: usize) -> Result<(), Error> {
    if p.lexer.token == 7 {
        let stepped = unsafe { lexer_next(&mut p.lexer) };
        if (stepped.is_err() as usize | p.lint_word()) != 0 { return annotation_slow(p, stepped, loc); }
        unsafe { skip_type(p)?; }
    }
    Ok(())
}
