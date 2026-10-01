#![crate_type = "lib"]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Error { UTF8Fail, OutOfMemory, SyntaxError, UnexpectedSyntax, ParserError, Backtrack }
pub struct Side { pub is_lint: bool, pub n: u64 }
pub struct P { pub token: u8, pub starts: Option<Box<Side>>, pub count: u64 }
#[derive(Clone, Copy)]
pub struct Stmt { pub tag: u8, pub loc: i32, pub data: u64 }
extern "Rust" {
    fn parse_stmt(p: &mut P) -> Result<Stmt, Error>;
    fn push(p: &mut P, s: Stmt);
}
impl P {
    #[inline(always)]
    fn lint_word(&self) -> usize { match &self.starts { Some(b) => (&**b) as *const Side as usize, None => 0 } }
}
pub enum Slow { Skip, Keep(Stmt) }
#[cold] #[inline(never)]
fn stmt_slow(p: &mut P, r: Result<Stmt, Error>) -> Result<Slow, Error> {
    let s = r?;
    if s.tag == 9 { if let Some(b) = &mut p.starts { b.n += 1; } return Ok(Slow::Skip); }
    Ok(Slow::Keep(s))
}
// base: `let stmt = parse_stmt()?; if stmt is the placeholder { continue }; push`
#[no_mangle]
pub fn stmts_base(p: &mut P) -> Result<(), Error> {
    while p.token != 3 {
        let stmt = unsafe { parse_stmt(p)? };
        if stmt.tag == 9 { continue; }
        unsafe { push(p, stmt) };
    }
    Ok(())
}
// merged shape: own test inside the placeholder arm
#[no_mangle]
pub fn stmts_own_test(p: &mut P) -> Result<(), Error> {
    while p.token != 3 {
        let stmt = unsafe { parse_stmt(p)? };
        if stmt.tag == 9 { if let Some(b) = &mut p.starts { b.n += 1; } continue; }
        unsafe { push(p, stmt) };
    }
    Ok(())
}
// folded into the error test of parse_stmt
#[no_mangle]
pub fn stmts_folded(p: &mut P) -> Result<(), Error> {
    while p.token != 3 {
        let r = unsafe { parse_stmt(p) };
        let w = ((r.is_err() as usize) << 56).wrapping_add(p.lint_word());
        let stmt = if w != 0 {
            match stmt_slow(p, r)? { Slow::Skip => continue, Slow::Keep(s) => s }
        } else {
            match r { Ok(s) => s, Err(_) => unsafe { core::hint::unreachable_unchecked() } }
        };
        if stmt.tag == 9 { continue; }
        unsafe { push(p, stmt) };
    }
    Ok(())
}
