#!/usr/bin/env bash
# Regenerate the perf-trace event list from Rust call sites.
#
# Scans for both call shapes:
#   - bun_core::perf::trace("Event.name")          (string-literal form)
#   - bun_perf::trace(PerfEvent::VariantName)      (enum form)
#
# and emits:
#   - src/jsc/bindings/generated_perf_trace_events.h  (X-macro, sorted, 0-indexed)
#   - src/perf/generated_perf_trace_events.rs         (#[repr(i32)] PerfEvent enum)
#
# Not run during the build; re-run manually when adding new trace() calls.

set -euo pipefail
cd "$(dirname "$0")/.."

LITERAL_EVENTS=$(rg 'bun_core::perf::trace\("([^"]+)"\)' -t rust -o -r '$1' src/ | sort -u)

# For PerfEvent::X call sites, map the variant back to its dotted name via the
# current as_cstr() table (so re-running preserves the existing id↔name map).
ENUM_VARIANTS=$(rg 'bun_perf::trace\(PerfEvent::([A-Za-z0-9_]+)\)' -t rust -o -r '$1' src/ | sort -u)
ENUM_EVENTS=""
for v in $ENUM_VARIANTS; do
    name=$(rg "PerfEvent::${v}\s*=>\s*c\"([^\"]+)\"" src/perf/generated_perf_trace_events.rs -o -r '$1' || true)
    if [ -z "$name" ]; then
        # New variant without a cstr mapping yet: synthesize Foo.Bar from FooBar.
        name=$(echo "$v" | sed -E 's/([a-z])([A-Z])/\1.\2/g; s/^_//')
    fi
    ENUM_EVENTS="$ENUM_EVENTS"$'\n'"$name"
done

ALL_EVENTS=$(printf '%s\n%s\n' "$LITERAL_EVENTS" "$ENUM_EVENTS" | grep -v '^$' | sort -u)

if [ -z "$ALL_EVENTS" ]; then
    echo "error: no perf::trace() call sites found under src/" >&2
    exit 1
fi

H_OUT=src/jsc/bindings/generated_perf_trace_events.h
{
    echo "// Generated with scripts/generate-perf-trace-events.sh"
    echo "// clang-format off"
    echo "#define FOR_EACH_TRACE_EVENT(macro) \\"
    i=0
    while IFS= read -r ev; do
        echo "  macro($ev, $i) \\"
        i=$((i + 1))
    done <<< "$ALL_EVENTS"
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
    while IFS= read -r ev; do
        variant=$(echo "$ev" | sed 's/[^A-Za-z0-9]//g')
        echo "    $variant = $i,"
        i=$((i + 1))
    done <<< "$ALL_EVENTS"
    echo "}"
    echo
    echo "impl PerfEvent {"
    echo "    pub fn as_cstr(self) -> &'static CStr {"
    echo "        match self {"
    while IFS= read -r ev; do
        variant=$(echo "$ev" | sed 's/[^A-Za-z0-9]//g')
        echo "            PerfEvent::$variant => c\"$ev\","
    done <<< "$ALL_EVENTS"
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
