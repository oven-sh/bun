#include "engine/Support.h"

#include <cstdarg>
#include <cstdio>

static void printCallSite(const char* file, int line, const char* function)
{
    fprintf(stderr, "%s(%d) : %s\n", file, line, function);
}

void WTFReportAssertionFailureWithMessage(const char* file, int line, const char* function, const char* assertion, const char* format, ...)
{
    fputs("ASSERTION FAILED: ", stderr);
    va_list arguments;
    va_start(arguments, format);
    vfprintf(stderr, format, arguments);
    va_end(arguments);
    fprintf(stderr, "\n%s\n", assertion);
    printCallSite(file, line, function);
}

void WTF::Detail::failAssertion(const char* file, int line, const char* function, const char* assertion)
{
    if (assertion)
        fprintf(stderr, "ASSERTION FAILED: %s\n", assertion);
    else
        fputs("SHOULD NEVER BE REACHED\n", stderr);
    printCallSite(file, line, function);
    WTFReportBacktrace();
    CRASH();
}
