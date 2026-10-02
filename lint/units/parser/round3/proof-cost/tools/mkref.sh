#!/bin/sh
# The reference text of a parse without lint, as two trees under <dir> (default /tmp/costproof/root):
#   <dir>/ref/src/js_parser       main at f4d755a9cf + the sink form (2d28b35c01) + the boxed tables (c5aaa06d78) + Metadata::MDot in the arena
#   <dir>/reflink/src/js_parser   the same + what a link against the crates of the head build needs (nothing of it is called)
# usage: mkref.sh [<dir>] [<repository>]        Nothing is written into the repository.
set -e
D=${1:-/tmp/costproof/root}; W=${2:-/workspace/bun}
rm -rf "$D/ref" "$D/reflink"; mkdir -p "$D/ref"
git -C "$W" archive f4d755a9cf src/js_parser | tar -x -C "$D/ref"
git -C "$W" diff d5b9c4329a e3566be889 -- src/js_parser | (cd "$D/ref" && patch -p1 -s)
python3 - "$D/ref/src/js_parser" <<'PY'
import sys
d = sys.argv[1]
def edit(rel, pairs):
    p = d + '/' + rel; s = open(p).read()
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old[:60], s.count(old))
        s = s.replace(old, new)
    open(p, 'w').write(s)
# be1ebe5295 on the sink form: TypeSink::member takes the arena, MDot is a StoreSlice<Ref>
edit('parse/type_sink.rs', [
    ("use bun_ast::Ref;\n", "use bun_alloc::Arena;\nuse bun_ast::Ref;\nuse bun_ast::StoreSlice;\n"),
    ("    fn member<'a, E>(\n        out: &mut Self::Out,\n        name: &'a [u8],", "    fn member<'a, E>(\n        out: &mut Self::Out,\n        arena: &Arena,\n        name: &'a [u8],"),
    ("    fn member<'a, E>(\n        _out: &mut (),\n        _name: &'a [u8],", "    fn member<'a, E>(\n        _out: &mut (),\n        _arena: &Arena,\n        _name: &'a [u8],"),
    ("    fn member<'a, E>(\n        out: &mut Metadata,\n        name: &'a [u8],", "    fn member<'a, E>(\n        out: &mut Metadata,\n        arena: &Arena,\n        name: &'a [u8],"),
    ("                let id = *id;\n                let mut dot: Vec<Ref> = Vec::with_capacity(2);\n                dot.push(id);\n                let member = find(name)?;\n                dot.push(member);\n                *out = Metadata::MDot(dot);\n",
     "                let id = *id;\n                let member = find(name)?;\n                *out = Metadata::MDot(StoreSlice::new(arena.alloc_slice_copy(&[id, member])));\n"),
    ("                if is_name {\n                    dot.push(find(name)?);\n                }\n",
     "                if is_name {\n                    let member = find(name)?;\n                    let names = dot.slice();\n                    let longer = arena.alloc_slice_fill_with(names.len() + 1, |i| {\n                        names.get(i).copied().unwrap_or(member)\n                    });\n                    *dot = StoreSlice::new(longer);\n                }\n"),
])
edit('parse/parse_skip_typescript.rs', [
    ("                    S::member(out, self.lexer.identifier, is_name, |name| {", "                    let arena = self.arena;\n                    S::member(out, arena, self.lexer.identifier, is_name, |name| {"),
])
edit('p.rs', [
    ("            M::MDot(refs) => {\n                debug_assert!(refs.len() >= 2);\n                // (refs.deinit(p.arena) — arena-backed; nothing to free in Rust)\n",
     "            M::MDot(refs) => {\n                let refs = refs.slice();\n                debug_assert!(refs.len() >= 2);\n"),
])
PY
cp -r "$D/ref" "$D/reflink"
python3 - "$D/reflink/src/js_parser" <<'PY'
import sys
d = sys.argv[1]
def edit(rel, pairs):
    p = d + '/' + rel; s = open(p).read()
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old[:60], s.count(old))
        s = s.replace(old, new)
    open(p, 'w').write(s)
# v0 mangling numbers the impl blocks of a module: the crates of the head build (23a20afa7e) name Parser, Options and P by the numbering
# that has one more impl before them (impl StartsForParseOnly in p.rs, impl ParsedForLint in parse_entry.rs)
edit('p.rs', [("impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Drop for P<'a, TYPESCRIPT, SCAN_ONLY> {",
               "// Keeps the numbering of the impl blocks of this module.\nimpl StartsForParseOnly {}\n\nimpl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> Drop for P<'a, TYPESCRIPT, SCAN_ONLY> {")])
edit('parse/parse_entry.rs', [("impl<'a> Default for Options<'a> {",
               "// Keeps the numbering of the impl blocks of this module.\nimpl<'a> ParsedOnly<'_, 'a> {}\n\nimpl<'a> Default for Options<'a> {")])
# -Zshare-generics: four instantiations that other crates of the head build take from this crate
open(d + '/lib.rs', 'a').write('''
/// Measurement only: the shared generic instantiations that the other crates of the head build take from this crate.
#[doc(hidden)]
#[inline(never)]
pub fn shared_generics_of_the_head_build<'a>(
    text: &'a [u8],
    names: &mut Vec<&'a [u8]>,
    msgs: &mut Vec<bun_ast::Msg>,
) -> bool {
    names.reserve(1);
    msgs.drain(..);
    text.strip_prefix(b"12345").is_some() | text.strip_prefix(b"123456789").is_some()
}
''')
PY
echo "$D/ref and $D/reflink written"
