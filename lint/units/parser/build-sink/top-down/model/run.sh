#!/bin/sh
# Model of the type grammar (one recursive core, helpers, three sinks) to test how a change to the generic code
# changes the machine code of the Discard and DecoratorMetadata instantiations. Nothing here is Bun code.
#   model.rs + grammar_p1.rs            the grammar as it is before the Build sink (no --cfg)
#   model.rs + grammar_p2.rs + build.rs variant "values": hooks return values, helpers return With<X, Y>   -> differs
#   model_v2.rs + grammar_v2.rs         variant "const guards": if S::KEEPS { .. } around every hook       -> differs
#   model_v3.rs + grammar_v3.rs + build_v3.rs   variant "statement hooks that take the parser"             -> identical
#   model_v4.rs + grammar_v4.rs         v3 plus a Part carrier local and kind arguments                    -> identical
# usage: sh run.sh            (needs rustc, llvm-cxxfilt; for the ThinLTO form also opt and llc of the same LLVM)
set -e
cd "$(dirname "$0")"
O=${TMPDIR:-/tmp}/build-sink-model; mkdir -p $O
F="--edition 2024 --crate-type=lib --crate-name model -C opt-level=3 -C codegen-units=1 -C panic=abort -C symbol-mangling-version=v0 --emit=asm"
rustc $F model_v3.rs -o $O/p1.s 2>/dev/null
rustc $F model.rs -o $O/p1-old.s 2>/dev/null
rustc $F --cfg p2 model.rs -o $O/values-hooks-only.s 2>/dev/null
rustc $F --cfg p2 model_v2.rs -o $O/guards-hooks-only.s 2>/dev/null
rustc $F --cfg p2 model_v3.rs -o $O/v3-hooks-only.s 2>/dev/null
rustc $F --cfg p2 --cfg build model_v3.rs -o $O/v3-build.s 2>/dev/null
rustc $F --cfg p2 model_v4.rs -o $O/v4-hooks-only.s 2>/dev/null
for v in values-hooks-only guards-hooks-only; do
  printf '%-20s ' $v; python3 cmpasm.py $O/p1-old.s $O/$v.s | grep -v 'SAME\|ONLY B' | tr '\n' ';'; echo
done
for v in v3-hooks-only v3-build v4-hooks-only; do
  printf '%-20s ' $v; python3 cmpasm.py $O/p1.s $O/$v.s | grep -v 'SAME\|ONLY B' | tr '\n' ';'; echo
done
if command -v opt >/dev/null 2>&1 || [ -x /usr/lib/llvm-current/bin/opt ]; then
  B=/usr/lib/llvm-current/bin; L="--edition 2024 --crate-type=lib --crate-name model -C opt-level=3 -C codegen-units=1 -C panic=abort -C symbol-mangling-version=v0 -C linker-plugin-lto --emit=obj"
  rustc $L model_v3.rs -o $O/t1.bc 2>/dev/null; rustc $L --cfg p2 --cfg build model_v3.rs -o $O/t2.bc 2>/dev/null; rustc $L --cfg p2 model_v3.rs -o $O/t2nb.bc 2>/dev/null
  for t in t1 t2 t2nb; do $B/opt -passes='thinlto<O3>' $O/$t.bc -o $O/$t.opt.bc; $B/llc -O3 -relocation-model=pic $O/$t.opt.bc -o $O/$t.s; done
  printf '%-20s ' thinlto-hooks-only; python3 cmpasm.py $O/t1.s $O/t2nb.s | grep -v 'SAME\|ONLY B' | tr '\n' ';'; echo
  printf '%-20s ' thinlto-build; python3 cmpasm.py $O/t1.s $O/t2.s | grep -v 'SAME\|ONLY B' | tr '\n' ';'; echo
fi
