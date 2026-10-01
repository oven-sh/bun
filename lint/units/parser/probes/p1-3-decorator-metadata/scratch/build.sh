#!/bin/sh
# Compiles the decorator metadata sink of the worktree on its own: the trait head, the sinks Discard and DecoratorMetadata
# of src/js_parser/parse/type_sink.rs and Metadata of src/ast/ts.rs, verbatim, with driver.rs as a cut of the grammar.
# usage: sh build.sh [worktree]     writes ${TMPDIR:-/tmp}/p1-3-sink/scratch, which reads one type per line (see driver.rs)
set -e
W=${1:-/workspace/wt/parser}
O=${TMPDIR:-/tmp}/p1-3-sink
mkdir -p "$O"
cp "$(dirname "$0")/driver.rs" "$O/driver.rs"
python3 - "$W" "$O" <<'PY'
import sys
w, o = sys.argv[1], sys.argv[2]
ts = open(w + '/src/ast/ts.rs').read()
meta = ts[ts.index('#[derive(Clone, Default)]\npub enum Metadata'):]
sink = open(w + '/src/js_parser/parse/type_sink.rs').read()
t0 = sink.index('pub(crate) trait TypeSink {')
t1 = sink.index('    /// The type in `out`, as a parent keeps it.')
o0 = sink.index('/// What a sink decided from the left operand.')
o1 = sink.index('/// A child type as its parent keeps it.')
open(o + '/scratch.rs', 'w').write('''#![allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Ref(pub u32);
impl Ref { pub const fn eql(self, o: Ref) -> bool { self.0 == o.0 } }
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Level { Lowest }
''' + meta + '\n' + sink[t0:t1] + '}\n\n' + sink[o0:o1] + '\ninclude!("driver.rs");\n')
PY
rustc --edition 2024 -O -o "$O/scratch" "$O/scratch.rs"
echo "$O/scratch"
