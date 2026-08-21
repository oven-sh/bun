#!/usr/bin/env bash
# Regenerate the perf-trace event list from Rust call sites.
#
# Scans for both call shapes:
#   - bun_core::perf::trace("Event.name")          (string-literal form)
#   - bun_perf::trace(PerfEvent::VariantName)      (enum form, any qualifier)
#
# and emits:
#   - src/jsc/bindings/generated_perf_trace_events.h  (X-macro, sorted, 0-indexed)
#   - src/perf/generated_perf_trace_events.rs         (#[repr(i32)] PerfEvent enum)
#
# Not run during the build; re-run manually when adding new trace() calls.

set -euo pipefail
cd "$(dirname "$0")/.."

# rg exits 1 on zero matches; each form is allowed to be empty so long as the
# combined set isn't. -I/--no-filename: rg prints path prefixes when searching
# a directory and we only want the captured group.
LITERAL_EVENTS=$(rg 'bun_core::perf::trace\("([^"]+)"\)' -t rust -I -o -r '$1' src/ | sort -u || true)

# Enum form: accept any of PerfEvent::X, bun_perf::PerfEvent::X, ::bun_perf::PerfEvent::X.
ENUM_VARIANTS=$(rg '(?:::)?bun_perf::trace\((?:::)?(?:bun_perf::)?PerfEvent::([A-Za-z0-9_]+)\)' \
    -t rust -I -o -r '$1' src/ | sort -u || true)

# Build "dotted\tvariant" pairs. For literal-form callers the variant name is
# derived from the literal (non-alnum stripped, first of each segment
# uppercased). For enum-form callers the variant is what the caller wrote and
# the dotted name is looked up in the current as_cstr() table so re-running
# preserves existing names; rustfmt wraps long arms across lines so match with -U.
PAIRS=""

while IFS= read -r ev; do
    [ -z "$ev" ] && continue
    variant=$(echo "$ev" | perl -pe 's/(^|[^A-Za-z0-9])([a-z])/$1\u$2/g; s/[^A-Za-z0-9]//g')
    PAIRS="$PAIRS"$'\n'"$ev"$'\t'"$variant"
done <<< "$LITERAL_EVENTS"

for v in $ENUM_VARIANTS; do
    name=$(rg -U "PerfEvent::${v}\b\s*=>\s*\{?\s*c\"([^\"]+)\"" \
        src/perf/generated_perf_trace_events.rs -o -r '$1' || true)
    if [ -z "$name" ]; then
        # New variant without a cstr mapping yet: synthesize Foo.Bar from FooBar.
        name=$(echo "$v" | sed -E 's/([a-z])([A-Z])/\1.\2/g; s/^_//')
    fi
    PAIRS="$PAIRS"$'\n'"$name"$'\t'"$v"
done

# Sort by dotted name (stable ids across runs); dedup by dotted name first,
# then by derived variant (two literals like "X.foo" and "X::foo" collapse).
# `awk NF` drops blank lines without the exit-1-on-no-match behaviour of grep.
PAIRS=$(echo "$PAIRS" | awk 'NF' | sort -t$'\t' -k1,1 -u | awk -F'\t' '!seen[$2]++')

if [ -z "$PAIRS" ]; then
    echo "error: no perf::trace() call sites found under src/" >&2
    exit 1
fi

H_OUT=src/jsc/bindings/generated_perf_trace_events.h
{
    echo "// Generated with scripts/generate-perf-trace-events.sh"
    echo "// clang-format off"
    echo "#define FOR_EACH_TRACE_EVENT(macro) \\"
    i=0
    while IFS=$'\t' read -r dotted variant; do
        echo "  macro($dotted, $i) \\"
        i=$((i + 1))
    done <<< "$PAIRS"
    echo "  // end"
} > "$H_OUT"
echo "Generated $H_OUT"

RS_OUT=src/perf/generated_perf_trace_events.rs
{
    echo "// Generated with scripts/generate-perf-trace-events.sh"
    echo "//"
    echo "// Discriminants match the ids in src/jsc/bindings/generated_perf_trace_events.h"
    echo "// (the Darwin signpost path reads the event by integer id)."
    echo
    echo "#![allow(non_camel_case_types)]"
    echo
    echo "use core::ffi::CStr;"
    echo
    echo "#[repr(i32)]"
    echo "#[derive(Copy, Clone, Eq, PartialEq)]"
    echo "pub enum PerfEvent {"
    i=0
    while IFS=$'\t' read -r dotted variant; do
        echo "    $variant = $i,"
        i=$((i + 1))
    done <<< "$PAIRS"
    echo "}"
    echo
    echo "impl PerfEvent {"
    echo "    pub fn as_cstr(self) -> &'static CStr {"
    echo "        match self {"
    while IFS=$'\t' read -r dotted variant; do
        echo "            PerfEvent::$variant => c\"$dotted\","
    done <<< "$PAIRS"
    echo "        }"
    echo "    }"
    echo "}"
    echo
    echo "impl From<PerfEvent> for &'static str {"
    echo "    fn from(e: PerfEvent) -> &'static str {"
    echo "        e.as_cstr().to_str().unwrap()"
    echo "    }"
    echo "}"
} > "$RS_OUT"
rustfmt "$RS_OUT" 2>/dev/null || true
echo "Generated $RS_OUT"
