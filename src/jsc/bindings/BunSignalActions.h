#pragma once

#include "root.h"

#if !OS(WINDOWS)

#include <signal.h>

namespace Bun {

// sigaction() and signal() for the listeners of a program and for the libraries it loads. Compiled code raises access faults
// on purpose, on every thread, and handles those before the action set here runs, whatever that action is.
int setSignalAction(int signalNumber, const struct sigaction* action, struct sigaction* previousAction);
void (*setSignalHandler(int signalNumber, void (*handler)(int)))(int);

void setDefaultSignalAction(int signalNumber);
void reportOwnCrash(int signalNumber, siginfo_t*, void* context);
bool mayReportOwnCrash(int signalNumber);

} // namespace Bun

#endif // !OS(WINDOWS)
