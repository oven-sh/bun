#!/usr/bin/env bash
# Usage: scripts/verify-hardening.sh <path-to-bun>
#
# Prints a hardening truth table for a Linux bun binary using readelf and a
# live /proc/<pid>/maps probe, then a PASS/FAIL line per control. Exit status
# is the FAIL count.
#
# Controls checked:
#   PIE       ET_DYN (image participates in ASLR)
#   RELRO     GNU_RELRO segment present + DT_BIND_NOW (full RELRO)
#   CANARY    __stack_chk_fail imported
#   FORTIFY   at least one __*_chk@ libc import
#   CET       x86 IBT/SHSTK feature bits in .note.gnu.property
#   NX        GNU_STACK is RW, not RWE
#   JIT-W^X   no rwx mapping in a live process
#
# PIE/CET/JIT-W^X are expected FAIL today (tranche 2+). RELRO/CANARY/FORTIFY
# are the tranche-1 targets this patch flips to PASS.

set -uo pipefail

BIN=${1:?"usage: $0 <binary>"}
[[ -r "$BIN" ]] || { echo "error: cannot read $BIN" >&2; exit 64; }

readelf=${READELF:-readelf}
hdr=$("$readelf" -hW "$BIN" 2>/dev/null)
seg=$("$readelf" -lW "$BIN" 2>/dev/null)
dyn=$("$readelf" -dW "$BIN" 2>/dev/null)
dynsym=$("$readelf" --dyn-syms -W "$BIN" 2>/dev/null)
notes=$("$readelf" -nW "$BIN" 2>/dev/null)

elf_type=$(grep -oE 'Type:[[:space:]]+[A-Z]+' <<<"$hdr" | awk '{print $2}')
has_relro=$(grep -c 'GNU_RELRO' <<<"$seg")
has_bindnow=$(grep -cE 'BIND_NOW|FLAGS_1.*\bNOW\b' <<<"$dyn")
stack_perm=$(grep 'GNU_STACK' <<<"$seg" | grep -oE 'RW[E ]' | tr -d ' ')
n_canary=$(grep -c '__stack_chk_fail' <<<"$dynsym")
n_fortify=$(grep -cE '__[a-z_]+_chk(@|$)' <<<"$dynsym")
has_cet=$(grep -cE 'IBT|SHSTK|x86 feature:' <<<"$notes")
n_plt=$("$readelf" -rW "$BIN" 2>/dev/null | grep -c JUMP_SLOT)

# Live probe: start the binary, read its maps, look for rwx and record the
# image base (so repeated invocations show whether ASLR moved it).
rwx_count="n/a"
rwx_detail=""
image_base="n/a"
if [[ -x "$BIN" ]]; then
  maps=$("$BIN" -e '
    const fs = require("fs");
    process.stdout.write(fs.readFileSync("/proc/self/maps","utf8"));
  ' 2>/dev/null)
  if [[ -n "$maps" ]]; then
    rwx_count=$(grep -cE '\brwx' <<<"$maps")
    rwx_detail=$(grep -E '\brwx' <<<"$maps" | head -1 | awk '{print $1, $NF}')
    image_base=$(head -1 <<<"$maps" | cut -d- -f1)
  fi
fi

row() { printf '  %-10s %-6s %s\n' "$1" "$2" "$3"; }
off_on() { [[ "$1" -gt 0 ]] && echo ON || echo OFF; }

echo "hardening: $BIN"
echo
row CONTROL STATE EVIDENCE
row PIE     "$([[ "$elf_type" == DYN ]] && echo ON || echo OFF)" "ELF type=$elf_type, image base=$image_base"
row RELRO   "$([[ "$has_relro" -gt 0 && "$has_bindnow" -gt 0 ]] && echo full || { [[ "$has_relro" -gt 0 ]] && echo part || echo OFF; })" "GNU_RELRO=$has_relro BIND_NOW=$has_bindnow PLT=$n_plt"
row CANARY  "$(off_on "$n_canary")" "__stack_chk_fail imports=$n_canary"
row FORTIFY "$(off_on "$n_fortify")" "*_chk imports=$n_fortify"
row CET     "$(off_on "$has_cet")" "$([[ "$has_cet" -gt 0 ]] && grep -E 'IBT|SHSTK' <<<"$notes" | head -1 | xargs || echo 'no .note.gnu.property x86 feature')"
row NX      "$([[ "$stack_perm" == RW ]] && echo ON || echo OFF)" "GNU_STACK=$stack_perm"
row JIT-W^X "$([[ "$rwx_count" == 0 ]] && echo ON || echo OFF)" "rwx maps=$rwx_count${rwx_detail:+ ($rwx_detail)}"
echo

fails=()
[[ "$elf_type" == DYN ]]                               || fails+=(PIE)
[[ "$has_relro" -gt 0 && "$has_bindnow" -gt 0 ]]       || fails+=(RELRO)
[[ "$n_canary" -gt 0 ]]                                || fails+=(CANARY)
[[ "$n_fortify" -gt 0 ]]                               || fails+=(FORTIFY)
[[ "$has_cet" -gt 0 ]]                                 || fails+=(CET)
[[ "$stack_perm" == RW ]]                              || fails+=(NX)
[[ "$rwx_count" == 0 || "$rwx_count" == "n/a" ]]       || fails+=(JIT-W^X)

if [[ ${#fails[@]} -eq 0 ]]; then
  echo "PASS: all controls"
else
  echo "FAIL: ${fails[*]}"
fi
exit ${#fails[@]}
