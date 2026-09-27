// The address space of the image as the host keeps it, for both hosts.
//
// 1. A table of the ranges that the image mapped: sorted, not overlapping, every
//    range with the protection that the image asked for (Linux PROT_ bits).
//
// 2. The "reserve and commit" model on top of it, for a system that cannot do
//    what Linux mmap does: Windows. There
//      - address space is reserved in blocks that start on a 64 KiB boundary and can
//        only be released as a whole,
//      - a page is usable after it was committed, and commit is accounted: the sum
//        of what is committed has to fit into memory plus paging file.
//    The image asks for Linux semantics:
//      - munmap and MAP_FIXED on a part of a mapping: the pages are decommitted and
//        the table forgets (or replaces) the range. A block is released when no
//        range of the table is left in it.
//      - MAP_NORESERVE with a protection that allows access (JavaScriptCore: 1 GiB
//        of RWX for the JIT, mimalloc: arenas of 1 GiB and a page map of 8 GiB, all
//        of it touched sparsely): reserved only, a page is committed when it is
//        touched first. The fault handler of the host asks model_fault().
//      - PROT_NONE: reserved only, committed by the mprotect that makes it accessible
//        (thread stacks of the libc, JavaScriptCore's reserve / commit protocol).
//      - MADV_DONTNEED: decommit, which also gives zeros at the next access.
//    The kernel does not run the fault handler of the host. Before the host hands
//    memory of the image to a system call it calls model_touch() on it.
//
// The model is written against five primitives (os_reserve, os_release, os_commit,
// os_decommit, os_protect). host_win.c implements them with VirtualAlloc,
// VirtualFree and VirtualProtect. host_posix.c implements them with mmap and
// mprotect for BUN_HOST_TEST=winmem, which runs the model on Linux.
//
// The host defines before it includes this file:
//   MEMORY_PAGE                      the page size (an expression)
//   memory_lock(), memory_unlock()   one lock for table and blocks
//   table_alloc(bytes)               zero filled memory that is not part of the table
//   table_free(p, bytes)
//   os_reserve(hint, bytes)          address space at `hint` (0: anywhere), 0 if that is not free
//   os_release(base, bytes)          a whole block
//   os_commit(start, bytes, prot)    0 or a negative Linux errno. The pages read as zero.
//   os_decommit(start, bytes)
//   os_protect(start, bytes, prot)   committed pages only
// os_commit, os_decommit and os_protect are called for pages of one block only.
#ifndef BUN_HOST_MEMORY_H
#define BUN_HOST_MEMORY_H

#include <stddef.h>
#include <stdint.h>
#include <string.h>

enum {
  R_ANON = 1,       /* anonymous private memory */
  R_FILE = 2,       /* the content of a file */
  R_LAZY = 4,       /* model: commit at the first touch */
  R_COMMITTED = 8,  /* model: the pages are committed */
  R_MAIN_STACK = 16, /* the stack that the host made for the main thread */
  R_JIT = 32        /* mapped with write and execute at once: code that is written */
};
struct region { uintptr_t start, end; uint32_t prot, flags; };
struct block { uintptr_t base, size; };

#define MEMORY_GRANULARITY 0x10000ull
/* A host uses the functions of the model that it needs. */
#define MEMORY_API __attribute__((unused)) static

static struct region *regions;
static size_t region_count, region_capacity;
static struct block *blocks;
static size_t block_count, block_capacity;

static uintptr_t page_down(uintptr_t x) { return x & ~((uintptr_t)(MEMORY_PAGE) - 1); }
static uintptr_t page_up(uintptr_t x) { return page_down(x + (uintptr_t)(MEMORY_PAGE) - 1); }
static uintptr_t granule_up(uintptr_t x) { return (x + MEMORY_GRANULARITY - 1) & ~(MEMORY_GRANULARITY - 1); }

/* ---- table ---- */
static int table_grow(void **items, size_t *capacity, size_t item, size_t want) {
  if (want <= *capacity) return 0;
  size_t bigger = *capacity ? *capacity * 2 : 1024;
  while (bigger < want) bigger *= 2;
  void *p = table_alloc(bigger * item);
  if (!p) return -1;
  if (*items) {
    memcpy(p, *items, *capacity * item);
    table_free(*items, *capacity * item);
  }
  *items = p;
  *capacity = bigger;
  return 0;
}

/* The first range that ends after addr. */
static size_t region_index(uintptr_t addr) {
  size_t lo = 0, hi = region_count;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    if (regions[mid].end > addr) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
static struct region *region_at(uintptr_t addr) {
  size_t i = region_index(addr);
  return i < region_count && regions[i].start <= addr ? &regions[i] : 0;
}
static int region_insert(size_t i, struct region r) {
  if (table_grow((void **)&regions, &region_capacity, sizeof *regions, region_count + 1)) return -1;
  memmove(regions + i + 1, regions + i, (region_count - i) * sizeof *regions);
  regions[i] = r;
  region_count++;
  return 0;
}
static void region_delete(size_t i, size_t n) {
  memmove(regions + i, regions + i + n, (region_count - i - n) * sizeof *regions);
  region_count -= n;
}
/* Makes `at` a border: the range that contains it becomes two. */
static int region_split(uintptr_t at) {
  size_t i = region_index(at);
  if (i == region_count || regions[i].start >= at) return 0;
  struct region upper = regions[i];
  upper.start = at;
  if (region_insert(i + 1, upper)) return -1;
  regions[i].end = at;
  return 0;
}
/* Joins neighbours that are alike, from range `from` to range `to`. */
static void region_join(size_t from, size_t to) {
  if (from > 0) from--;
  for (size_t i = from; i + 1 < region_count && i <= to;) {
    struct region *a = &regions[i], *b = a + 1;
    if (a->end == b->start && a->prot == b->prot && a->flags == b->flags) {
      a->end = b->end;
      region_delete(i + 1, 1);
      if (to > 0) to--;
    } else i++;
  }
}
static int region_clear(uintptr_t start, uintptr_t end) {
  if (region_split(start) || region_split(end)) return -1;
  size_t i = region_index(start), j = i;
  while (j < region_count && regions[j].start < end) j++;
  region_delete(i, j - i);
  return 0;
}
static int region_set(uintptr_t start, uintptr_t end, uint32_t prot, uint32_t flags) {
  if (region_clear(start, end)) return -1;
  size_t i = region_index(start);
  struct region r = {start, end, prot, flags};
  if (region_insert(i, r)) return -1;
  region_join(i, i + 1);
  return 0;
}
/* 1 if every page of the range belongs to a range of the table. */
static int region_covers(uintptr_t start, uintptr_t end) {
  for (size_t i = region_index(start); start < end; i++) {
    if (i == region_count || regions[i].start > start) return 0;
    start = regions[i].end;
  }
  return 1;
}
static int region_overlaps(uintptr_t start, uintptr_t end) {
  size_t i = region_index(start);
  return i < region_count && regions[i].start < end;
}

/* ---- blocks of the model ---- */
static size_t block_index(uintptr_t addr) {
  size_t lo = 0, hi = block_count;
  while (lo < hi) {
    size_t mid = (lo + hi) / 2;
    if (blocks[mid].base + blocks[mid].size > addr) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
static struct block *block_at(uintptr_t addr) {
  size_t i = block_index(addr);
  return i < block_count && blocks[i].base <= addr ? &blocks[i] : 0;
}
static int block_add(uintptr_t base, size_t size) {
  if (table_grow((void **)&blocks, &block_capacity, sizeof *blocks, block_count + 1)) return -1;
  size_t i = block_index(base);
  memmove(blocks + i + 1, blocks + i, (block_count - i) * sizeof *blocks);
  blocks[i].base = base;
  blocks[i].size = size;
  block_count++;
  return 0;
}
/* Releases the blocks that touch the range and have no range of the table left. */
static void block_release_empty(uintptr_t start, uintptr_t end) {
  for (size_t i = block_index(start); i < block_count && blocks[i].base < end;) {
    if (region_overlaps(blocks[i].base, blocks[i].base + blocks[i].size)) {
      i++;
      continue;
    }
    os_release(blocks[i].base, blocks[i].size);
    memmove(blocks + i, blocks + i + 1, (block_count - i - 1) * sizeof *blocks);
    block_count--;
  }
}

/* ---- the primitives, one block at a time ----
   Windows takes one call of VirtualAlloc (commit), VirtualFree (decommit) or VirtualProtect
   for pages of ONE reservation, and refuses a range that goes on into the next one. The
   ranges of the table are joined over the borders of blocks, and what the image asks for
   (MAP_FIXED, munmap, mprotect, madvise) is for any range. So a range goes to the system
   in the pieces that the blocks cut it into. */
static uintptr_t piece_end(uintptr_t at, uintptr_t end) {
  size_t i = block_index(at);
  if (i < block_count) {
    uintptr_t stop = blocks[i].base > at ? blocks[i].base : blocks[i].base + blocks[i].size;
    if (stop < end) return stop;
  }
  return end;
}
static long long commit_pieces(uintptr_t start, uintptr_t end, uint32_t prot) {
  for (uintptr_t at = start, stop; at < end; at = stop) {
    stop = piece_end(at, end);
    long long e = os_commit(at, stop - at, prot);
    if (e) return e;
  }
  return 0;
}
static void decommit_pieces(uintptr_t start, uintptr_t end) {
  for (uintptr_t at = start, stop; at < end; at = stop) {
    stop = piece_end(at, end);
    os_decommit(at, stop - at);
  }
}
static long long protect_pieces(uintptr_t start, uintptr_t end, uint32_t prot) {
  for (uintptr_t at = start, stop; at < end; at = stop) {
    stop = piece_end(at, end);
    long long e = os_protect(at, stop - at, prot);
    if (e) return e;
  }
  return 0;
}

/* ---- the model ---- */
static void model_decommit(uintptr_t start, uintptr_t end) {
  for (size_t i = region_index(start); i < region_count && regions[i].start < end; i++) {
    if (!(regions[i].flags & R_COMMITTED)) continue;
    uintptr_t a = regions[i].start > start ? regions[i].start : start, b = regions[i].end < end ? regions[i].end : end;
    decommit_pieces(a, b);
  }
}
/* The range is inside of blocks and nothing of it is committed. */
static long long model_place(uintptr_t start, size_t size, uint32_t prot, uint32_t flags) {
  if (prot && !(flags & R_LAZY)) {
    long long e = commit_pieces(start, start + size, prot);
    if (e) {
      region_clear(start, start + size);
      block_release_empty(start, start + size);
      return e;
    }
    flags |= R_COMMITTED;
  }
  if (region_set(start, start + size, prot, flags)) return -L_ENOMEM;
  return (long long)start;
}
static long long model_map_locked(uintptr_t addr, size_t size, uint32_t prot, long long map_flags, uint32_t flags) {
  if (!(map_flags & (L_MAP_FIXED | L_MAP_FIXED_NOREPLACE))) {
    size_t reserve = granule_up(size);
    uintptr_t base = 0;
    if (addr && !(addr & (MEMORY_GRANULARITY - 1))) base = os_reserve(addr, reserve);
    if (!base) base = os_reserve(0, reserve);
    if (!base) return -L_ENOMEM;
    if (block_add(base, reserve)) {
      os_release(base, reserve);
      return -L_ENOMEM;
    }
    return model_place(base, size, prot, flags);
  }
  uintptr_t end = addr + size;
  if ((map_flags & L_MAP_FIXED_NOREPLACE) && region_overlaps(addr, end)) return -L_EEXIST;
  /* What is not inside of a block yet gets blocks of its own. That is possible
     only from a 64 KiB boundary on. */
  for (uintptr_t at = addr; at < end;) {
    struct block *b = block_at(at);
    if (b) {
      at = b->base + b->size;
      continue;
    }
    size_t next = block_index(at);
    uintptr_t stop = next < block_count && blocks[next].base < end ? blocks[next].base : end;
    if (at & (MEMORY_GRANULARITY - 1)) return -L_ENOMEM;
    size_t reserve = granule_up(stop - at);
    if (next < block_count && at + reserve > blocks[next].base) return -L_ENOMEM;
    if (!os_reserve(at, reserve)) return -L_ENOMEM;
    if (block_add(at, reserve)) {
      os_release(at, reserve);
      return -L_ENOMEM;
    }
    at += reserve;
  }
  model_decommit(addr, end);
  return model_place(addr, size, prot, flags);
}
/* A reservation that the host made by itself (a segment of the image) becomes a block, so
   that no call of a primitive goes over its borders. base and size: multiples of 64 KiB. */
MEMORY_API int model_adopt(uintptr_t base, size_t size) {
  memory_lock();
  int r = block_add(base, size);
  memory_unlock();
  return r;
}
MEMORY_API long long model_map(uintptr_t addr, size_t len, uint32_t prot, long long map_flags, uint32_t kind) {
  if (!len || (addr & ((uintptr_t)(MEMORY_PAGE) - 1) && (map_flags & (L_MAP_FIXED | L_MAP_FIXED_NOREPLACE)))) return -L_EINVAL;
  uint32_t flags = kind | (prot && (map_flags & L_MAP_NORESERVE) ? R_LAZY : 0);
  memory_lock();
  long long r = model_map_locked(addr, page_up(len), prot, map_flags, flags);
  memory_unlock();
  return r;
}
MEMORY_API long long model_unmap(uintptr_t addr, size_t len) {
  if (addr & ((uintptr_t)(MEMORY_PAGE) - 1)) return -L_EINVAL;
  uintptr_t end = addr + page_up(len);
  long long r = 0;
  memory_lock();
  model_decommit(addr, end);
  if (region_clear(addr, end)) r = -L_ENOMEM;
  else block_release_empty(addr, end);
  memory_unlock();
  return r;
}
MEMORY_API long long model_protect(uintptr_t addr, size_t len, uint32_t prot) {
  if (addr & ((uintptr_t)(MEMORY_PAGE) - 1)) return -L_EINVAL;
  uintptr_t end = addr + page_up(len);
  long long r = 0;
  memory_lock();
  if (!region_covers(addr, end) || region_split(addr) || region_split(end)) r = -L_ENOMEM;
  else {
    size_t first = region_index(addr), i = first;
    for (; i < region_count && regions[i].start < end && !r; i++) {
      struct region *p = &regions[i];
      if (p->flags & R_COMMITTED) r = protect_pieces(p->start, p->end, prot);
      else if (prot && !(p->flags & R_LAZY)) {
        r = commit_pieces(p->start, p->end, prot);
        if (!r) p->flags |= R_COMMITTED;
      }
      if (!r) p->prot = prot;
    }
    region_join(first, i);
  }
  memory_unlock();
  return r;
}
MEMORY_API long long model_discard(uintptr_t addr, size_t len) {
  if (addr & ((uintptr_t)(MEMORY_PAGE) - 1)) return -L_EINVAL;
  uintptr_t end = addr + page_up(len);
  long long r = 0;
  memory_lock();
  if (region_split(addr) || region_split(end)) r = -L_ENOMEM;
  else {
    size_t first = region_index(addr), i = first;
    for (; i < region_count && regions[i].start < end; i++) {
      struct region *p = &regions[i];
      if ((p->flags & (R_COMMITTED | R_ANON)) != (R_COMMITTED | R_ANON)) continue;
      decommit_pieces(p->start, p->end);
      /* Committed again at the next touch, or by the mprotect that makes it accessible
         again, or now. */
      if ((p->flags & R_LAZY) || !p->prot) p->flags &= ~(uint32_t)R_COMMITTED;
      else if (commit_pieces(p->start, p->end, p->prot)) {
        p->flags = (p->flags & ~(uint32_t)R_COMMITTED) | R_LAZY;
      }
    }
    region_join(first, i);
  }
  memory_unlock();
  return r;
}
static int prot_allows(uint32_t prot, int write, int execute) {
  if (write) return !!(prot & L_PROT_WRITE);
  if (execute) return !!(prot & L_PROT_EXEC);
  return prot != 0;
}
static int model_commit_piece(struct region *p, uintptr_t start, uintptr_t end) {
  uint32_t prot = p->prot, flags = p->flags | R_COMMITTED;
  if (commit_pieces(start, end, prot)) return -1;
  return region_set(start, end, prot, flags);
}
/* A fault at addr. 1: the page is usable now (or was made usable by another thread in the
   meantime), the access is to be tried again. 0: the fault is a matter of the image. */
MEMORY_API int model_fault(uintptr_t addr, int write, int execute) {
  int handled = 0;
  memory_lock();
  struct region *p = region_at(addr);
  if (p && prot_allows(p->prot, write, execute)) {
    if (p->flags & R_COMMITTED) handled = 1;
    else {
      struct block *b = block_at(addr);
      uintptr_t chunk = b && b->size >= (64ull << 20) ? 1ull << 20 : MEMORY_GRANULARITY;
      uintptr_t start = addr & ~(chunk - 1), end = start + chunk;
      if (start < p->start) start = p->start;
      if (end > p->end) end = p->end;
      handled = !model_commit_piece(p, start, end);
    }
  }
  memory_unlock();
  return handled;
}
/* The host is about to hand [addr, addr + len) to the kernel. */
MEMORY_API void model_touch(uintptr_t addr, size_t len) {
  if (!len) return;
  uintptr_t at = page_down(addr), end = page_up(addr + len);
  memory_lock();
  while (at < end) {
    size_t i = region_index(at);
    if (i == region_count || regions[i].start >= end) break;
    struct region *p = &regions[i];
    if (at < p->start) at = p->start;
    uintptr_t stop = p->end < end ? p->end : end;
    if (!(p->flags & R_COMMITTED) && (p->flags & R_LAZY) && p->prot && model_commit_piece(p, at, stop)) break;
    at = stop;
  }
  memory_unlock();
}

#endif
