#!/usr/bin/env python3
# usage: python3 apply-toggles.py <scratch copy of src/js_parser, after apply-prototype.py>
# Probe only, never for the tree: B1_DISABLE turns one part of the change off, so that a probe shows which sources need it.
#   1 = the comments of a forward move are dropped, 2 = those inside JSX tags, 4 = those before the first token.
import sys, os
p = os.path.join(sys.argv[1], 'lexer.rs')
s = open(p).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, old[:60]
    s = s.replace(old, new)
rep("""const _: () = assert!(core::mem::size_of::<Lexer<'static>>() == 336);""", """pub static B1_DISABLE: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(0);
fn b1_disabled(bit: u8) -> bool {
    B1_DISABLE.load(core::sync::atomic::Ordering::Relaxed) & bit != 0
}

const _: () = assert!(core::mem::size_of::<Lexer<'static>>() == 336);""")
rep("""    fn push_comment_in_jsx_tag(&mut self) {
        self.all_comments.push(self.range());""", """    fn push_comment_in_jsx_tag(&mut self) {
        if b1_disabled(2) {
            return;
        }
        self.all_comments.push(self.range());""")
rep("""        if primed != TrackComments::Off || self.start == 0 {
            return;
        }""", """        if primed != TrackComments::Off || self.start == 0 || b1_disabled(4) {
            return;
        }""")
rep("""        if self.track_comments != TrackComments::All {
            return Vec::new();
        }""", """        if self.track_comments != TrackComments::All || b1_disabled(1) {
            return Vec::new();
        }""")
open(p, 'w').write(s)
print('ok toggles')
