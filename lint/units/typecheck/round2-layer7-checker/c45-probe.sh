#!/bin/sh
# Probe of src/typecheck/checker/c45_base_constraints_normalization.rs with rustc and clippy-driver alone (no cargo).
# One crate compiles the real file in place, beside the real leaf modules of the tree (core, collections, jsnum,
# stringutil, tspath, diagnostics, internal, ast, scanner) and the real checker/{types,c01_data,links}.rs. The rest
# of checker/ is a stand-in whose signature c45-probe-gen.py reads from the file of the tree that defines it, and the
# call sites of the functions that the file brings are compiled with it as the other files write them.
# bun_core and bun_collections are the real crates: their metadata is what `cargo check -p bun_typecheck` left in
# target/debug/build/*/*/out (the survey writes it), so the probe needs one survey run before it.
# What the probe cannot say: whether the stand-in signatures still match when the tree changes after the run, and
# anything about what the functions compute.
# usage: sh c45-probe.sh      work directory: $C45_WORK (default /tmp/c45probe-run)
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=/workspace/wt/typecheck
FILE=$REPO/src/typecheck/checker/c45_base_constraints_normalization.rs
W=${C45_WORK:-/tmp/c45probe-run}
rm -rf "$W"
mkdir -p "$W"
python3 "$HERE/c45-probe-gen.py" "$W"
cd "$W"
T=$REPO/target/debug/build
DEPS=""
for d in "$T"/*/*/out; do DEPS="$DEPS -L dependency=$d"; done
EXT="--extern bun_core=$(ls "$T"/bun_core/*/out/libbun_core-*.rmeta) --extern bun_collections=$(ls "$T"/bun_collections/*/out/libbun_collections-*.rmeta)"
# 1. Types, borrows and the deny set of the workspace (the root has #![deny(warnings)] and allows dead_code only).
rustc --edition 2024 --crate-type lib --crate-name c45probe --emit=metadata -o c45probe.rmeta c45-probe.rs $EXT $DEPS
# 2. The clippy table of the workspace and the clippy.toml of the repository.
FLAGS=$(sed 's/-D unreachable[-_]pub//; s/-D dead[-_]code//' "$HERE/../conventions-scratch/data/clippy_flags.txt")
CLIPPY_CONF_DIR=$REPO clippy-driver --edition 2024 --crate-type lib --crate-name c45probe --emit=metadata -o c45probe_clippy.rmeta c45-probe.rs $EXT $DEPS -A dead_code -W clippy::all $FLAGS > clippy.txt 2>&1 || { cat clippy.txt; exit 1; }
if [ -s clippy.txt ]; then cat clippy.txt; exit 1; fi
# 3. The probe must see an error in the functions that the file brings: each line is a copy of the file with one wrong token.
mutant() {
  sed "$1" "$FILE" > mutant.rs
  if cmp -s mutant.rs "$FILE"; then echo "mutant '$2' changed nothing"; exit 1; fi
  sed "s|$FILE|$W/mutant.rs|" c45-probe.rs > mutant-probe.rs
  if rustc --edition 2024 --crate-type lib --crate-name c45mutant --emit=metadata -o c45mutant.rmeta mutant-probe.rs $EXT $DEPS > mutant.txt 2>&1; then
    echo "the probe accepts the mutant '$2'"
    exit 1
  fi
}
mutant 's/reference_kinds |= SymbolFlags::ALL;/reference_kinds |= CheckFlags::INSTANTIATED;/' 'flag set of another type in mark_property_as_referenced'
mutant 's/c.get_indexed_access_type(object_type, t);/c.get_indexed_access_type(object_type, writing);/' 'bool for a type in distribute_object_over_index_type'
mutant 's/CachedTypeKind::INDEXED_ACCESS_FOR_WRITING,/CachedTypeKind::INDEXED_ACCESS_FOR_WRITINGS,/' 'unknown cache kind in get_simplified_indexed_access_type'
mutant 's/self.get_type_from_mapped_type_node(declaration);/self.get_type_from_mapped_type_node(t);/' 'type for a node in get_modifiers_type_from_mapped_type'
mutant 's/(object_type, index, 0, writing, false);/(object_type, index, writing, false);/' 'missing argument in get_simplified_indexed_access_type_worker'
rustfmt --edition 2024 --check "$FILE"
echo "c45_base_constraints_normalization.rs: probe ok"
