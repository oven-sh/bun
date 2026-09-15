#pragma once

// <winternl.h> declares a global `STRING` and then names it unqualified, which
// is ambiguous with JSC::STRING once a `using namespace JSC` is in effect (any
// earlier file of a unified bundle).
#define STRING BunWinternlSTRING
#include <winternl.h>
#undef STRING
