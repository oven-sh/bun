// Stand-in for the loader: owns one native thread slot. Built without -femulated-tls.
#include <stdint.h>
static __thread void *tcb_slot __attribute__((tls_model("initial-exec")));
void slot_set(void *tcb) { tcb_slot = tcb; }
uintptr_t slot_offset(void) { return (uintptr_t)&tcb_slot - (uintptr_t)__builtin_thread_pointer(); }
