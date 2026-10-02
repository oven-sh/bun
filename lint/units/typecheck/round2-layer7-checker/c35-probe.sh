#!/bin/sh
# Probe of src/typecheck/checker/c35_resolve_members.rs with rustc and clippy-driver alone (no cargo).
# One crate compiles the real file in place, beside the real leaf modules of the tree (core, collections, jsnum,
# stringutil, tspath, diagnostics, internal, ast, scanner) and the real checker/{types,c01_data,links}.rs. The rest
# of checker/ is a stand-in whose signature c35-probe-gen.py reads from the file of the tree that defines it, and the
# call sites of the three functions of checker.go 21008-21164 are compiled with it as the other files write them.
# bun_core and bun_collections are the real crates: their metadata is what `cargo check -p bun_typecheck` left in
# target/debug/build/*/*/out (the survey writes it), so the probe needs one survey run before it.
# What the probe cannot say: whether the stand-in signatures still match when the tree changes after the run, and
# anything about what the functions compute.
# usage: sh c35-probe.sh      work directory: $C35_WORK (default /tmp/c35probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=/workspace/wt/typecheck
FILE=$REPO/src/typecheck/checker/c35_resolve_members.rs
W=${C35_WORK:-/tmp/c35probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/c35-probe-gen.py" "$W"
cd "$W"
T=$REPO/target/debug/build
DEPS=""
for d in "$T"/*/*/out; do DEPS="$DEPS -L dependency=$d"; done
EXT="--extern bun_core=$(ls "$T"/bun_core/*/out/libbun_core-*.rmeta) --extern bun_collections=$(ls "$T"/bun_collections/*/out/libbun_collections-*.rmeta)"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name c35probe --emit=metadata -o c35probe.rmeta c35-probe.rs $EXT $DEPS
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//; s/-D dead[-_]code//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=$REPO clippy-driver --edition 2024 --crate-type lib --crate-name c35probe --emit=metadata -o c35probe_clippy.rmeta c35-probe.rs $EXT $DEPS -A dead_code -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
# 3. The probe must see an error in the three functions: each line is a copy of the file with one wrong token.
mutant() {
  sed "$1" "$FILE" > mutant.rs
  if cmp -s mutant.rs "$FILE"; then echo "mutant '$2' changed nothing"; exit 1; fi
  sed "s|$FILE|$W/mutant.rs|" c35-probe.rs > mutant-probe.rs
  if rustc --edition 2024 --crate-type lib --crate-name c35mutant --emit=metadata -o c35mutant.rmeta mutant-probe.rs $EXT $DEPS > mutant.txt 2>&1; then
    echo "the probe accepts the mutant '$2'"
    exit 1
  fi
  grep -q "$3" mutant.txt || { echo "the mutant '$2' fails for another reason than $3"; cat mutant.txt; exit 1; }
}
mutant 's/\.synthetic_origin = modifiers_prop;/.synthetic_origin = key_type;/' 'type for a symbol in resolve_mapped_type_members' 'E0308'
mutant 's/let include = TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE;/let include = TypeFlags::STRING_OR_NUMBER_LITERAL_OR_UNIQUE; let unused_include = include;/' 'unused variable in resolve_mapped_type_members' 'unused variable'
mutant 's/prop_type = self.get_optional_type(prop_type, true);/prop_type = self.get_optional_type(prop_type);/' 'missing argument in get_type_of_mapped_symbol' 'E0061'
mutant 's/prepend_type_mapping(self, root_check_type, constraint, mapper);/prepend_type_mapping(self, mapper, root_check_type, constraint);/' 'mapper for a type in get_lower_bound_of_key_type' 'E0308'
mutant 's/self.same_map(types, |c, u| c.get_lower_bound_of_key_type(u));/self.same_map(types, |_, u| self.get_lower_bound_of_key_type(u));/' 'second borrow of the checker in get_lower_bound_of_key_type' 'E0500'
rustfmt --edition 2024 --check "$FILE"
echo "c35_resolve_members.rs: probe ok"
