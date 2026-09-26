#pragma once

#include "root.h"

#if OS(WINDOWS)

// POSIX constants that Node has on Windows (fs.constants, os.constants.signals)
// and that the UCRT spells differently or does not have.

#include <io.h> // _S_IREAD _S_IWRITE
#include <sys/stat.h>

#ifndef S_IRUSR
#define S_IRUSR _S_IREAD
#endif // S_IRUSR
#ifndef S_IWUSR
#define S_IWUSR _S_IWRITE
#endif // S_IWUSR
// The UCRT only defines the underscore-prefixed _S_IFIFO; whether the plain
// spelling is visible otherwise depends on what happened to be defined earlier
// in the unified source.
#if !defined(S_IFIFO) && defined(_S_IFIFO)
#define S_IFIFO _S_IFIFO
#endif // S_IFIFO
// Not in the UCRT. Node has them on Windows with these values.
#ifndef S_IFLNK
#define S_IFLNK 0xA000
#endif // S_IFLNK
#ifndef F_OK
#define F_OK 0
#define R_OK 4
#define W_OK 2
#define X_OK 1
#endif // F_OK

#include "BunWindowsSignals.h"

#endif // OS(WINDOWS)
