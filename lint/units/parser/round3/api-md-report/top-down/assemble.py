#!/usr/bin/env python3
"""Builds the API.md of the parser unit for the end of round 3 from the blocks of this directory.
usage: assemble.py [--known FILE] [--api FILE] [--out FILE] [--markers]
  --known FILE   the section "Known differences of a parse without lint", as gen/lists3.mjs of
                 round3/lint-grammar-tests-r4/bottom-up-1a writes it for the cases that a lint parse reads as main does
                 (default: generated/api-known-differences.as-without-lint-209-212-124-296-297-300-308.txt there)
  --api FILE     the API.md that holds the section "Type nodes" (default: the one of the unit)
  --out FILE     default API.next.txt beside this file
  --markers      print every marker that is left, with its line in the output
The type nodes section is taken from --api as it is, with three paragraphs replaced. Everything else is the blocks.
A marker is [[FILL id: ...]], [[CHECK id: ...]] or [[PICK id: ...]] ... [[OR]] ... [[END]]: see INDEX.txt."""
import os, re, sys
here = os.path.dirname(os.path.abspath(__file__))
unit = os.path.normpath(os.path.join(here, '..', '..', '..'))
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
KNOWN = arg('--known', os.path.join(unit, 'round3/lint-grammar-tests-r4/bottom-up-1a/generated/api-known-differences.as-without-lint-209-212-124-296-297-300-308.txt'))
API = arg('--api', os.path.join(unit, 'API.md'))
OUT = arg('--out', os.path.join(here, 'API.next.txt'))
def block(name): return open(os.path.join(here, 'blocks', name)).read().rstrip('\n') + '\n'
def once(text, old, new, what):
    if text.count(old) != 1: sys.exit(f'assemble.py: "{what}" is {text.count(old)} times in its source, not once')
    return text.replace(old, new)

# 1. the type nodes: from the heading to the next section of the old file
api = open(API).read()
a = api.index('## Type nodes: `bun_ast::ts`')
b = api.index('## Syntax errors of a lint parse: the codes of the reference')
nodes = api[a:b].rstrip('\n') + '\n'
if 'Nothing builds these nodes yet' in nodes:
    nodes = once(nodes,
        "Commit `e1c99be1a4` on `robobun/abbc0c92/lint-parser`. File `src/ast/ts_nodes.rs`, which `src/ast/ts.rs` declares with\n"
        "`#[path]` and re-exports: every name below is `bun_ast::ts::<name>`. `src/ast/lib.rs` and the existing AST types are\n"
        "unchanged. Nothing builds these nodes yet: the `Build` sink does.\n",
        "File `src/ast/ts_nodes.rs`, which has one commit (`e1c99be1a4`) and which `src/ast/ts.rs` declares with `#[path]` and\n"
        "re-exports: every name below is `bun_ast::ts::<name>`. The existing AST types are unchanged. The lint grammar builds\n"
        "these nodes with the `Build` sink, except `TypeData::JSDocAll`, `KeywordKind::Intrinsic`, `Body` and\n"
        "`TypeParameter::expression`, which nothing builds.\n"
        "[[CHECK nodes-unchanged: `git log --oneline -- src/ast/ts_nodes.rs` is one line, and `bun run rust:miri -p bun_ast` runs its seven tests]]\n",
        'the intro of the type nodes')
    s = nodes.index('### State at that commit\n')
    e = nodes.index('### Tests\n', s)
    nodes = nodes[:s] + ("### State\n\n"
        "Built in the worktree and in CI on every platform. Every size of this section is a `const` assertion of\n"
        "`src/ast/ts_nodes.rs`, which every build evaluates.\n\n") + nodes[e:]
    nodes = once(nodes, "the variant with `IntoTypeData::type_data` and `IntoMemberData::member_data`. A test in another crate that has no\narena can do the same.\n",
        "the variant with `IntoTypeData::type_data` and `IntoMemberData::member_data`. A test in another crate that has no\narena can do the same. `bun_ast` is in `MIRI_CRATES` (`scripts/rust-miri.ts`), so CI runs them.\n",
        'the tests of the type nodes')

# 2. the known differences: without the three lines of its head, and with the section of the lint grammar after it
known = open(KNOWN).read()
known = known[known.index('## Known differences of a parse without lint'):].rstrip('\n') + '\n'
lint = ''
m = re.search(r'^## Known differences of the lint grammar\n', known, re.M)
if m:
    rest = known[m.start():]
    n = re.search(r'^### Checked against the corpora of round 2\n', rest, re.M)
    lint = (rest[:n.start()] if n else rest).rstrip('\n') + '\n'
    known = known[:m.start()] + (rest[n.start():] if n else '')
known = known.rstrip('\n') + '\n'
note = ("[[CHECK known-generated: this section and the next are the output of gen/lists3.mjs "
        f"(`bash run.sh <state>` in round3/lint-grammar-tests-r4/bottom-up-1a) for `{os.path.basename(KNOWN)}`. "
        "Make it again for the cases of `KNOWN_DIFFERENCES` of the grammar_rows_tests.rs that is in the tree, and for the base binary of the day. "
        "File and line after \"Where main decides\" are those of main at f4d755a9cf, whose parser files fa467dcae2 has unchanged; "
        "the branch has the same functions in the sink form, at other lines]]\n")
known = once(known, '## Known differences of a parse without lint\n', '## Known differences of a parse without lint\n\n' + note, 'the heading of the known differences')

# 3. the side table: the comments stand between the four tables and the notes about all of them
erased = block('51-side-table-erased.txt')
cut = erased.index('### What the typecheck unit asked for')
parts = [block('00-head-state.txt'), block('20-two-grammars.txt'), known]
if lint: parts.append(lint)
parts += [block('40-lint-parse.txt'), block('50-side-table.txt'), erased[:cut].rstrip('\n') + '\n', block('52-comments.txt'),
          erased[cut:], nodes, block('60-syntax-errors.txt'), block('70-proofs.txt'), block('80-tests.txt'), block('90-memory.txt')]
text = '\n'.join(parts)
open(OUT, 'w').write(text)

lines = text.split('\n')
kinds = {}
for i, l in enumerate(lines):
    for k, ident in re.findall(r'\[\[(FILL|CHECK|PICK) ([a-z0-9-]+)', l):
        kinds.setdefault(k, []).append((i + 1, ident))
picks, ors, ends = len(kinds.get('PICK', [])), sum(l.strip() == '[[OR]]' for l in lines), sum(l.strip() == '[[END]]' for l in lines)
print(f'{OUT}: {len(lines)} lines, {len(text.encode())} bytes; headings: {sum(l.startswith("## ") for l in lines)} sections, {sum(l.startswith("### ") for l in lines)} subsections')
print(f'markers: FILL {len(kinds.get("FILL", []))}  CHECK {len(kinds.get("CHECK", []))}  PICK {picks} (with {ors} [[OR]] and {ends} [[END]])')
if picks != ors or picks != ends: sys.exit('assemble.py: a [[PICK]] without its [[OR]] or [[END]]')
if '--markers' in sys.argv:
    for k in ('PICK', 'FILL', 'CHECK'):
        for ln, ident in kinds.get(k, []): print(f'  {k:5} {ident:28} line {ln}')
