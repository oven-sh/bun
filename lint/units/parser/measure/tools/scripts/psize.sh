#!/bin/bash
# Size probe: appends array-length consts to p.rs, reads the sizes from the E0308 messages, restores the file.
# Runs as ONE command under the machine lock. cwd: /workspace/wt/parser
set -u
F=src/js_parser/p.rs
O=/workspace/notes/lint/units/parser/measure/base/psize
mkdir -p $O
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "worktree dirty, abort"; git status --short | head; exit 3; fi
cp -p $F /tmp/parser-base/p.rs.orig
restore() { cp -p /tmp/parser-base/p.rs.orig $F; if git diff --quiet -- $F; then echo RESTORED-OK; else echo RESTORE-FAILED; fi; }
trap restore EXIT
BASE_LINES=$(wc -l < $F)
stage() {
  name=$1
  cp -p /tmp/parser-base/p.rs.orig $F
  cat >> $F
  echo "probe lines start at $((BASE_LINES + 1))" > $O/$name.lines.txt
  sed -n "$((BASE_LINES + 1)),\$p" $F | nl -v $((BASE_LINES + 1)) >> $O/$name.lines.txt
  s=$(date +%s)
  cargo check -p bun_js_parser > $O/$name.dev.raw.txt 2>&1; echo "$name dev rc=$? $(( $(date +%s) - s ))s"
  s=$(date +%s)
  cargo check -p bun_js_parser --release > $O/$name.release.raw.txt 2>&1; echo "$name release rc=$? $(( $(date +%s) - s ))s"
  cp -p /tmp/parser-base/p.rs.orig $F
  for p in dev release; do
    echo "== $name $p"
    python3 - $O/$name.$p.raw.txt $O/$name.lines.txt <<'EOPY'
import re, sys
raw = open(sys.argv[1], errors='replace').read()
lines = {}
for l in open(sys.argv[2]).read().splitlines()[1:]:
    m = re.match(r'\s*(\d+)\s+(.*)$', l)
    if m: lines[int(m.group(1))] = m.group(2)
found = 0
for m in re.finditer(r'--> src/js_parser/p\.rs:(\d+):\d+.*?found one with a size of (\d+)', raw, re.S):
    ln = int(m.group(1)); found += 1
    what = re.search(r'(size_of|align_of)::<(.*)>\(\)', lines.get(ln, '?'))
    print(f"  {what.group(1) if what else '?':8} {what.group(2) if what else lines.get(ln):60} = {m.group(2)}")
if not found:
    print('  no size found; first errors:')
    print('\n'.join(x for x in raw.splitlines() if x.startswith('error'))[:1500])
EOPY
  done
}
stage p <<'EOP'
const _: [(); 0] = [(); core::mem::size_of::<P<'static, true, false>>()];
const _: [(); 0] = [(); core::mem::size_of::<P<'static, false, false>>()];
const _: [(); 0] = [(); core::mem::size_of::<P<'static, true, true>>()];
const _: [(); 0] = [(); core::mem::size_of::<P<'static, false, true>>()];
const _: [(); 0] = [(); core::mem::align_of::<P<'static, true, false>>()];
const _: [(); 0] = [(); core::mem::size_of::<StartsForParseOnly>()];
const _: [(); 0] = [(); core::mem::size_of::<Option<Box<StartsForParseOnly>>>()];
EOP
stage more <<'EOP'
const _: [(); 0] = [(); core::mem::size_of::<ParserSnapshot<'static>>()];
const _: [(); 0] = [(); core::mem::size_of::<js_lexer::Lexer<'static>>()];
const _: [(); 0] = [(); core::mem::size_of::<js_lexer::LexerSnapshot<'static>>()];
const _: [(); 0] = [(); core::mem::size_of::<js_ast::ts::Metadata>()];
const _: [(); 0] = [(); core::mem::size_of::<js_ast::Expr>()];
const _: [(); 0] = [(); core::mem::size_of::<js_ast::Stmt>()];
const _: [(); 0] = [(); core::mem::size_of::<ParserOptions<'static>>()];
EOP
