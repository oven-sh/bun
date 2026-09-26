// Thread-local schemes for a portable image, measured on linux-x64.
// The portable variants read the thread block through a segment register
// that is chosen at run time (fs on Linux, gs on Windows and macOS) and an
// offset that is a run-time value. No code is patched.
//
// Build variants:
//   native     compiler TLS, what the per-OS builds use today
//   emutls-rt  -femulated-tls with the compiler runtime's __emutls_get_address
//   emutls-own -femulated-tls with the __emutls_get_address below
//   inline     hand-written accessor, inlined (model for mimalloc and WTF)
//   call       hand-written accessor, out of line
#define _GNU_SOURCE
#include <pthread.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

enum { OS_LINUX = 1, OS_WINDOWS = 2, OS_MACOS = 3 };
unsigned char bun_host_os;     /* set once at startup */
uintptr_t bun_tcb_offset;      /* offset of our slot from the segment base */

struct emutls_array { size_t count; void *slots[]; };
struct bun_tcb {
  struct emutls_array *emutls;
  void *heap;                  /* what an allocator keeps per thread */
};

static inline __attribute__((always_inline)) struct bun_tcb *bun_tcb_inline(void) {
  struct bun_tcb *t;
  uintptr_t off = bun_tcb_offset;
  if (__builtin_expect(bun_host_os == OS_LINUX, 1))
    __asm__("movq %%fs:(%1), %0" : "=r"(t) : "r"(off));
  else
    __asm__("movq %%gs:(%1), %0" : "=r"(t) : "r"(off));
  return t;
}
__attribute__((noinline)) struct bun_tcb *bun_tcb_call(void) { return bun_tcb_inline(); }

#ifdef OWN_EMUTLS
struct emutls_control { size_t size, align; uintptr_t index; void *value; };
static pthread_mutex_t emutls_lock = PTHREAD_MUTEX_INITIALIZER;
static uintptr_t emutls_next;
static __attribute__((noinline)) void *emutls_slow(struct emutls_control *c) {
  struct bun_tcb *t = bun_tcb_inline();
  pthread_mutex_lock(&emutls_lock);
  if (!c->index) c->index = ++emutls_next;
  pthread_mutex_unlock(&emutls_lock);
  uintptr_t i = c->index;
  if (!t->emutls || t->emutls->count < i) {
    size_t n = i + 16;
    struct emutls_array *a = calloc(1, sizeof *a + n * sizeof(void *));
    if (t->emutls) memcpy(a->slots, t->emutls->slots, t->emutls->count * sizeof(void *));
    a->count = n;
    t->emutls = a;
  }
  void *p = aligned_alloc(c->align < 16 ? 16 : c->align, (c->size + 15) & ~(size_t)15);
  if (c->value) memcpy(p, c->value, c->size); else memset(p, 0, c->size);
  t->emutls->slots[i - 1] = p;
  return p;
}
void *__emutls_get_address(struct emutls_control *c) {
  struct emutls_array *a = bun_tcb_inline()->emutls;
  uintptr_t i = c->index;
  if (__builtin_expect(a && i && i <= a->count && a->slots[i - 1], 1)) return a->slots[i - 1];
  return emutls_slow(c);
}
#endif

struct heap { uint64_t used; uint64_t pad[7]; };

#if defined(VARIANT_INLINE) || defined(VARIANT_CALL)
#ifdef VARIANT_INLINE
#define TCB() bun_tcb_inline()
#else
#define TCB() bun_tcb_call()
#endif
__attribute__((noinline)) uint64_t fast_path(uint64_t n) {
  struct heap *h = TCB()->heap;
  h->used += n;
  return h->used;
}
static void thread_init(void) { TCB()->heap = calloc(1, sizeof(struct heap)); }
#else
static _Thread_local struct heap heap_storage;
static _Thread_local struct heap *current_heap;
__attribute__((noinline)) uint64_t fast_path(uint64_t n) {
  struct heap *h = current_heap;
  h->used += n;
  return h->used;
}
static void thread_init(void) { current_heap = &heap_storage; }
#endif

/* The slot itself is a host TLS variable in this test, so that fs:(offset)
   is valid under glibc. In the real image the loader owns the slot. */
void slot_set(void *tcb);
uintptr_t slot_offset(void);

int main(int argc, char **argv) {
  static struct bun_tcb main_tcb;
  slot_set(&main_tcb);
  bun_host_os = (unsigned char)(argc > 2 ? atoi(argv[2]) : OS_LINUX);
  bun_tcb_offset = slot_offset();
  thread_init();
  uint64_t iters = strtoull(argv[1], 0, 10), acc = 0;
  double best = 1e9;
  for (int round = 0; round < 5; round++) {
    struct timespec a, b;
    clock_gettime(CLOCK_MONOTONIC, &a);
    for (uint64_t i = 0; i < iters; i++) acc += fast_path(i & 15);
    clock_gettime(CLOCK_MONOTONIC, &b);
    double ns = ((b.tv_sec - a.tv_sec) * 1e9 + (b.tv_nsec - a.tv_nsec)) / iters;
    if (ns < best) best = ns;
  }
  printf("%.2f", best);
  return acc == 1;
}
