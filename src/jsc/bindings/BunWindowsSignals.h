#pragma once

#include "root.h"

#if OS(WINDOWS)

#include <signal.h>

// The CRT defines SIGINT (2), SIGILL (4), SIGABRT_COMPAT (6), SIGFPE (8),
// SIGSEGV (11), SIGTERM (15), SIGBREAK (21) and SIGABRT (22). Node has these
// four on Windows as well, with the numbers Linux and Darwin use. They are
// JS-visible: os.constants.signals, process.kill(), process.on().
#ifndef SIGHUP
#define SIGHUP 1
#endif
#ifndef SIGQUIT
#define SIGQUIT 3
#endif
#ifndef SIGKILL
#define SIGKILL 9
#endif
#ifndef SIGWINCH
#define SIGWINCH 28
#endif
static_assert(SIGHUP == 1 && SIGQUIT == 3 && SIGKILL == 9 && SIGWINCH == 28, "another header defines these with different numbers");

#endif // OS(WINDOWS)
