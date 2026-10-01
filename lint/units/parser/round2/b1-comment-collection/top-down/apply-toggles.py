#!/usr/bin/env python3
# usage: python3 apply-toggles.py <scratch copy of src/js_parser, after apply-prototype.py>
# Probe only, never for the tree: the environment variable B1_DISABLE turns one part of the change off, so that a probe
# shows which sources need it. 1 = the comments of a forward move are dropped, 2 = those inside JSX tags,
# 4 = those before the first token, 8 = no comment is tracked at all: the lint parse as it is at be1ebe5295.
import sys, os
p = os.path.join(sys.argv[1], 'lexer.rs')
s = open(p).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
rep("""#[cfg(target_pointer_width = "64")]
const _: () = assert!(core::mem::size_of::<Lexer<'static>>() == 336);""", """pub static B1_DISABLE: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(255);
fn b1_disabled(bit: u8) -> bool {
    let mut bits = B1_DISABLE.load(core::sync::atomic::Ordering::Relaxed);
    if bits == 255 {
        bits = std::env::var("B1_DISABLE")
            .ok()
            .and_then(|text| text.parse().ok())
            .unwrap_or(0);
        B1_DISABLE.store(bits, core::sync::atomic::Ordering::Relaxed);
    }
    bits & bit != 0
}

#[cfg(target_pointer_width = "64")]
const _: () = assert!(core::mem::size_of::<Lexer<'static>>() == 336);""")
rep("""    pub(crate) fn track_every_comment(&mut self, primed: bool) {
        self.track_comments = true;
        self.every_comment = 1;
        if primed || self.start == 0 {
            return;
        }""", """    pub(crate) fn track_every_comment(&mut self, primed: bool) {
        if b1_disabled(8) {
            return;
        }
        self.track_comments = true;
        self.every_comment = 1;
        if primed || self.start == 0 || b1_disabled(4) {
            return;
        }""")
rep("""        if self.every_comment == 0 {
            return Vec::new();
        }""", """        if self.every_comment == 0 || b1_disabled(1) {
            return Vec::new();
        }""")
rep("""    fn next_inside_jsx_element_with_comments(&mut self) -> Result<(), Error> {
        self.all_comments.push(self.range());
        self.next_inside_jsx_element_from::<true>()""", """    fn next_inside_jsx_element_with_comments(&mut self) -> Result<(), Error> {
        if b1_disabled(2) {
            self.every_comment = 0;
            let result = self.next_inside_jsx_element_from::<false>();
            self.every_comment = 1;
            return result;
        }
        self.all_comments.push(self.range());
        self.next_inside_jsx_element_from::<true>()""")
open(p, 'w').write(s)
print('ok toggles')
