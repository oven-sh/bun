#!/usr/bin/env bash
# Regenerate src/runtime/link_stubs.rs from the undefined-symbol dumps produced
# by `cargo build -p bun_bin 2>&1 | grep 'undefined reference' | ...`.
#
# Inputs (override via env):
#   CAT1=/tmp/cat1_classes.txt   - .classes.ts codegen symbols (Prototype__/Class__/__ZigStructSize/...)
#   UNDEFS=/tmp/undefs.txt       - full undefined-symbol list (one per line)
#
# Output:
#   src/runtime/link_stubs.rs    - #[unsafe(no_mangle)] panic stubs
#
# Signature heuristics mirror build/debug/codegen/ZigGeneratedClasses.{h,cpp} and
# JSSink.cpp; link only cares about the *name*, so any mismatch surfaces as a
# runtime crash, never a link error. panic-swarm replaces hot-path stubs.
set -euo pipefail

CAT1=${CAT1:-/tmp/cat1_classes.txt}
UNDEFS=${UNDEFS:-/tmp/undefs.txt}
OUT=${OUT:-$(dirname "$0")/../src/runtime/link_stubs.rs}

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

{
  cat "$CAT1"
  grep -E '^JS2Zig__'  "$UNDEFS" || true
  grep -E 'Sink__'     "$UNDEFS" || true
  grep -E '^bindgen_'  "$UNDEFS" || true
} | grep -E '^[A-Za-z_][A-Za-z0-9_]*$' | sort -u > "$tmp"

count=$(wc -l < "$tmp")

awk -v COUNT="$count" '
BEGIN {
  print "//! AUTO-GENERATED link stubs for the .classes.ts / JSSink / JS2Zig codegen gap."
  print "//! These exist solely so `cargo build -p bun_bin` links; every body panics."
  print "//! panic-swarm replaces hot-path ones with real ports."
  print "//!"
  print "//! Regenerate: scripts/gen-link-stubs.sh   (" COUNT " symbols)"
  print "#![allow(non_snake_case, non_upper_case_globals, improper_ctypes_definitions, unused_variables)]"
  print ""
  print "use core::ffi::c_void;"
  print "use bun_jsc::{JSGlobalObject, CallFrame, JSValue};"
  print ""
}
function host(sym)  { printf "#[unsafe(no_mangle)] pub extern \"C\" fn %s(_g: *const JSGlobalObject, _c: *const CallFrame) -> JSValue { unreachable!(\"codegen stub: %s\") }\n", sym, sym }
function ctor(sym)  { printf "#[unsafe(no_mangle)] pub extern \"C\" fn %s(_g: *const JSGlobalObject, _c: *const CallFrame) -> *mut c_void { unreachable!(\"codegen stub: %s\") }\n", sym, sym }
function fin(sym)   { printf "#[unsafe(no_mangle)] pub extern \"C\" fn %s(_p: *mut c_void) { unreachable!(\"codegen stub: %s\") }\n", sym, sym }
function sz(sym)    { printf "#[unsafe(no_mangle)] pub extern \"C\" fn %s(_p: *mut c_void) -> usize { unreachable!(\"codegen stub: %s\") }\n", sym, sym }
function bln(sym)   { printf "#[unsafe(no_mangle)] pub extern \"C\" fn %s(_p: *mut c_void) -> bool { unreachable!(\"codegen stub: %s\") }\n", sym, sym }
function pjv(sym)   { printf "#[unsafe(no_mangle)] pub extern \"C\" fn %s(_p: *mut c_void) -> JSValue { unreachable!(\"codegen stub: %s\") }\n", sym, sym }
function dflt(sym)  { printf "#[unsafe(no_mangle)] pub extern \"C\" fn %s() -> *mut c_void { unreachable!(\"codegen stub: %s\") }\n", sym, sym }
{
  s = $0
  if      (s ~ /__ZigStructSize$/)                        printf "#[unsafe(no_mangle)] pub static %s: usize = 0;\n", s
  else if (s ~ /__finalize$/)                             fin(s)
  else if (s ~ /__estimatedSize$/ || s ~ /__memoryCost$/) sz(s)
  else if (s ~ /__hasPendingActivity$/)                   bln(s)
  else if (s ~ /__getInternalFd$/)                        pjv(s)
  else if (s ~ /Class__construct$/)                       ctor(s)
  else if (s ~ /Prototype__/ || s ~ /Class__/)            host(s)
  else if (s ~ /^JS2Zig__/)                               host(s)
  else if (s ~ /Sink__/)                                  host(s)
  else if (s ~ /^bindgen_/)                               host(s)
  else                                                    dflt(s)
}
' "$tmp" > "$OUT"

echo "wrote $OUT ($count stubs)" >&2
