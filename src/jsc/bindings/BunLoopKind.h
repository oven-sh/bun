#pragma once

#include <stdint.h>

// Which of a VM's two embedded event loops a posted completion belongs to
// (bun_jsc::LoopKind). Decided on the VM's own thread when the work is
// initiated: `Regular`, or `Macro` while a macro is being run, so that a
// macro's wait services what the macro started and nothing else. Work that
// no script initiated (the debugger, signals, another thread's own doing)
// is `Regular`.
enum class BunLoopKind : uint8_t {
    Regular = 0,
    Macro = 1,
};

// JS thread only: the loop the VM is currently running (what a ticket taken now would record).
extern "C" BunLoopKind Bun__VM__currentLoopKind(void* bunVM);
