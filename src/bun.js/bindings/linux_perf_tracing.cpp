#include "root.h"

#if OS(LINUX)
#include <stdint.h>
#include <sys/types.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>

extern "C" {

// This is a simple implementation for Linux tracing using ftrace
// It writes to /sys/kernel/debug/tracing/trace_marker
//
// To use with perf:
// 1. Ensure kernel.perf_event_paranoid is set to a value that allows tracing
//    echo 1 > /proc/sys/kernel/perf_event_paranoid
// 2. Run perf record -e ftrace:print -a -- your_program
// 3. Run perf report

// Bun trace events will appear in the trace as:
// C|PID|EventName|DurationInNs
//
// Where 'C' means counter/complete events with end timestamps

#define TRACE_MARKER_PATH "/sys/kernel/debug/tracing/trace_marker"
#define MAX_EVENT_NAME_LENGTH 128

static int trace_fd = -1;

// Initialize the tracing system
int Bun__linux_trace_init()
{
    if (trace_fd != -1) {
        return 1; // Already initialized
    }

    trace_fd = open(TRACE_MARKER_PATH, O_WRONLY);
    return (trace_fd != -1) ? 1 : 0;
}

// Close the trace file descriptor
void Bun__linux_trace_close()
{
    if (trace_fd != -1) {
        close(trace_fd);
        trace_fd = -1;
    }
}

// Write a trace event to the trace marker
// Format: "C|PID|EventName|DurationInNs"
int Bun__linux_trace_emit(const char* event_name, int64_t duration_ns)
{
    if (trace_fd == -1) {
        return 0;
    }

    char buffer[MAX_EVENT_NAME_LENGTH + 64];
    int len = snprintf(buffer, sizeof(buffer),
        "C|%d|%s|%lld\n",
        getpid(), event_name, (long long)duration_ns);

    if (len <= 0) {
        return 0;
    }

    ssize_t written = write(trace_fd, buffer, len);
    return (written == len) ? 1 : 0;
}

} // end extern "C"
#endif
