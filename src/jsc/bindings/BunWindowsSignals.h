#pragma once

#include "root.h"

#if OS(WINDOWS)

#include <signal.h>

// The CRT defines SIGINT (2), SIGILL (4), SIGABRT_COMPAT (6), SIGFPE (8),
// SIGSEGV (11), SIGTERM (15), SIGBREAK (21) and SIGABRT (22). Node has these
// four on Windows as well, with the numbers Linux and Darwin use. They are
// JS-visible: os.constants.signals, process.kill(), process.on().
#define SIGHUP 1
#define SIGQUIT 3
#define SIGKILL 9
#define SIGWINCH 28

#if defined(NSIG) && NSIG <= SIGWINCH
#undef NSIG
#endif
#ifndef NSIG
#define NSIG (SIGWINCH + 1)
#endif

#endif // OS(WINDOWS)
