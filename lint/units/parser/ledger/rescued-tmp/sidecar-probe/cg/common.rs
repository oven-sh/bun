pub struct Lexer { pub token: u8, pub start: usize, pub end: usize, pub src: &'static [u8] }
impl Lexer {
    #[inline(never)]
    pub fn next(&mut self) -> Result<(), u8> {
        if self.end >= self.src.len() { self.token = 0; return Ok(()); }
        self.start = self.end; self.token = self.src[self.end]; self.end += 1;
        if self.token == b'!' { return Err(1); }
        Ok(())
    }
}
pub struct P { pub lexer: Lexer, pub side: Option<Box<Vec<(u32, u32)>>>, pub scopes: Vec<u32>, pub latest: usize, pub allow_in: bool, pub log: Vec<u32> }
impl P {
    #[inline(never)]
    pub fn grammar_discard(&mut self, level: u8, opts: u8) -> Result<(), u8> {
        let mut depth = level as u32;
        loop {
            match self.lexer.token { b'<' => { depth += 1; self.lexer.next()?; } b'>' => { if depth == 0 { return Ok(()); } depth -= 1; self.lexer.next()?; } b'a'..=b'z' => { self.lexer.next()?; if depth == level as u32 { return Ok(()); } } _ => { if opts != 0 { return Err(2); } return Ok(()); } }
        }
    }
    #[inline(never)]
    pub fn grammar_build(&mut self, level: u8) -> Result<(u32, u32), u8> {
        let s = self.lexer.start as u32; self.grammar_discard(level, 1)?; Ok((s, self.lexer.start as u32))
    }
    #[inline]
    pub fn skip_type(&mut self, level: u8) -> Result<(), u8> { self.grammar_discard(level, 0) }
    #[inline]
    pub fn skip_return_type(&mut self) -> Result<(), u8> { self.grammar_discard(0, 4) }
    #[inline(never)]
    pub fn parse_expr(&mut self, level: u8) -> Result<u64, u8> {
        let mut v = 0u64;
        while matches!(self.lexer.token, b'a'..=b'z' | b'0'..=b'9') { v = v * 31 + self.lexer.token as u64 + level as u64; self.lexer.next()?; }
        if self.lexer.token == b'(' { let loc = self.lexer.start as i32; self.lexer.next()?; v += self.paren_dispatch(loc, level)?; }
        Ok(v)
    }
    #[inline(never)]
    pub fn arrow_body(&mut self, args: &[u64]) -> Result<u64, u8> { self.lexer.next()?; let b = self.parse_expr(1)?; Ok(args.iter().sum::<u64>() ^ b) }
    pub fn log_errors(&mut self, e: &mut [u32; 2]) { if e[0] > 0 { self.log.push(e[0]); } if e[1] > 0 { self.log.push(e[1]); } }
    pub fn pop_and_flatten(&mut self, idx: usize) { if idx < self.scopes.len() { self.scopes[idx] = 0; if self.scopes.len() == idx + 1 { self.scopes.truncate(idx); } } }
    #[inline]
    fn backtrack_bool<F: FnOnce(&mut Self) -> Result<(), u8>>(&mut self, f: F) -> bool {
        let (t, s, e) = (self.lexer.token, self.lexer.start, self.lexer.end);
        let ok = f(self).is_ok();
        if !ok { self.lexer.token = t; self.lexer.start = s; self.lexer.end = e; }
        ok
    }
    pub fn try_arrow_return_type(&mut self) -> bool {
        self.backtrack_bool(|p| { if p.lexer.token != b':' { return Err(9); } p.lexer.next()?; p.skip_return_type()?; if p.lexer.token != b'=' { return Err(9); } Ok(()) })
    }
    #[cold] #[inline(never)]
    pub fn lint_binding_type(&mut self, key: u32) -> Result<(), u8> { let r = self.grammar_build(0)?; if let Some(s) = self.side.as_deref_mut() { s.push((key, r.0)); s.push((key, r.1)); } Ok(()) }
    #[cold] #[inline(never)]
    pub fn lint_arrow_return_type(&mut self, key: u32) -> Result<bool, u8> {
        let (t, s, e) = (self.lexer.token, self.lexer.start, self.lexer.end);
        let mark = self.side.as_deref().map_or(0, |v| v.len());
        let r: Result<(), u8> = (|| { self.lexer.next()?; let r = self.grammar_build(0)?; if self.lexer.token != b'=' { return Err(9); } if let Some(sd) = self.side.as_deref_mut() { sd.push((key, r.0)); } Ok(()) })();
        if r.is_err() { self.lexer.token = t; self.lexer.start = s; self.lexer.end = e; if let Some(sd) = self.side.as_deref_mut() { sd.truncate(mark); } }
        Ok(r.is_ok())
    }
}
