#!/usr/bin/env bash
# This file is not run often, so we don't need to make it part of the build system.
# We do this because the event names have to be compile-time constants.


export TRACE_EVENTS=$(rg 'bun\.perf\.trace\("([^"]*)"\)' -t zig --json \
    | jq -r 'select(.type == "match")' \
    | jq -r '.data.submatches[].match.text' \
    | cut -d'"' -f2 \
    | sort \
    | uniq)

echo "// Generated with scripts/generate-perf-trace-events.sh" > src/jsc/bindings/generated_perf_trace_events.h
echo "// clang-format off" >> src/jsc/bindings/generated_perf_trace_events.h
echo "#define FOR_EACH_TRACE_EVENT(macro) \\" >> src/jsc/bindings/generated_perf_trace_events.h
i=0
for event in $TRACE_EVENTS; do
    echo "  macro($event, $((i++))) \\" >> src/jsc/bindings/generated_perf_trace_events.h
done
echo "  // end" >> src/jsc/bindings/generated_perf_trace_events.h

echo "Generated src/jsc/bindings/generated_perf_trace_events.h"

echo "// Generated with scripts/generate-perf-trace-events.sh" > src/perf/generated_perf_trace_events.zig
echo "pub const PerfEvent = enum(i32) {" >> src/perf/generated_perf_trace_events.zig
for event in $TRACE_EVENTS; do
    echo "    @\"$event\"," >> src/perf/generated_perf_trace_events.zig
done
echo "};" >> src/perf/generated_perf_trace_events.zig

echo "Generated src/perf/generated_perf_trace_events.zig"