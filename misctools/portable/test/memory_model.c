// Test of host/memory.h by itself, on any machine: the table and the reserve and commit
// model run against primitives that only keep books, over a small address space, and
// after every operation the books are compared with a second, simple description of what
// the image may expect: one entry for every page.
//
//   cc -O2 -o memory_model test/memory_model.c && ./memory_model [operations] [seed]
//
// What is checked after each of the random operations (map anywhere, map fixed, unmap,
// protect, discard, fault, touch):
//   - the table is sorted, without overlap, and neighbours that are alike are joined
//   - every page: mapped or not, protection, and the content (zero after a new mapping
//     and after a discard, kept otherwise) are what the simple description says
//   - the primitives were used by their rules: commit and protect only inside of reserved
//     blocks, protect only on committed pages, release only of a whole block with no page
//     of the image left in it, blocks on 64 KiB boundaries, and one call of commit,
//     decommit or protect for pages of one block only (Windows refuses a range that goes
//     on into the next reservation)
//   - a page that the image can use is committed, or a fault on it commits it
#include <stdio.h>
#include <stdlib.h>

#include "../host/linux_abi.h"

#define PAGE 4096ull
#define SPACE_PAGES 4096 /* 16 MiB of address space, from SPACE_BASE on */
#define SPACE_BASE 0x10000000ull
#define MEMORY_PAGE PAGE

/* The books of the primitives: state of every page of the address space. */
static struct { unsigned char reserved, committed, prot, stamp; int block; } os_page[SPACE_PAGES];
static int next_block = 1, failures;
static unsigned long commits, decommits;

static void fail(const char *what, unsigned long long at) {
  if (failures++ < 20) printf("FAILED: %s at %#llx\n", what, at);
}
static size_t page_of(unsigned long long address) { return (size_t)((address - SPACE_BASE) / PAGE); }

static void memory_lock(void) {}
static void memory_unlock(void) {}
static void *table_alloc(size_t bytes) { return calloc(1, bytes); }
static void table_free(void *p, size_t bytes) { (void)bytes; free(p); }

static uintptr_t os_reserve(uintptr_t hint, size_t bytes) {
  size_t pages = bytes / PAGE, granule = 16;
  if (bytes % 0x10000) fail("reserve of a size that is no multiple of 64 KiB", bytes);
  if (hint) {
    if (hint % 0x10000) { fail("reserve at an address that is no multiple of 64 KiB", hint); return 0; }
    if (hint < SPACE_BASE || page_of(hint) + pages > SPACE_PAGES) return 0;
    for (size_t i = 0; i < pages; i++)
      if (os_page[page_of(hint) + i].reserved) return 0;
  } else {
    /* The first gap that is large enough, which makes the blocks neighbours of each other. */
    size_t run = 0, start = 0;
    for (size_t i = 0; i < SPACE_PAGES; i++) {
      if (run == 0 && i % granule) continue;
      if (os_page[i].reserved) { run = 0; continue; }
      if (run++ == 0) start = i;
      if (run == pages) break;
    }
    if (run < pages) return 0;
    hint = SPACE_BASE + start * PAGE;
  }
  for (size_t i = 0; i < pages; i++) {
    os_page[page_of(hint) + i].reserved = 1;
    os_page[page_of(hint) + i].block = next_block;
  }
  next_block++;
  return hint;
}
static void os_release(uintptr_t base, size_t bytes) {
  size_t first = page_of(base), pages = bytes / PAGE;
  int block = os_page[first].block;
  if (!os_page[first].reserved || (first && os_page[first - 1].reserved && os_page[first - 1].block == block)) fail("release that does not start at the start of a block", base);
  if (first + pages < SPACE_PAGES && os_page[first + pages].reserved && os_page[first + pages].block == block) fail("release of a part of a block", base);
  for (size_t i = 0; i < pages; i++) {
    if (os_page[first + i].block != block) fail("release over the end of a block", base);
    if (os_page[first + i].committed) fail("release of a block with committed pages", base + i * PAGE);
    os_page[first + i].reserved = os_page[first + i].committed = 0;
  }
}
static void one_block(const char *what, uintptr_t start, size_t bytes) {
  for (size_t i = 1; i < bytes / PAGE; i++)
    if (os_page[page_of(start) + i].reserved && os_page[page_of(start) + i].block != os_page[page_of(start)].block) {
      fail(what, start + i * PAGE);
      return;
    }
}
static long long os_commit(uintptr_t start, size_t bytes, uint32_t prot) {
  one_block("commit that goes on into another block", start, bytes);
  if (start % PAGE || bytes % PAGE || !prot) fail("commit with bad arguments", start);
  for (size_t i = 0; i < bytes / PAGE; i++) {
    size_t p = page_of(start) + i;
    if (!os_page[p].reserved) fail("commit outside of a block", start + i * PAGE);
    if (!os_page[p].committed) os_page[p].stamp = 0;
    os_page[p].committed = 1;
    os_page[p].prot = (unsigned char)prot;
  }
  commits++;
  return 0;
}
static void os_decommit(uintptr_t start, size_t bytes) {
  one_block("decommit that goes on into another block", start, bytes);
  for (size_t i = 0; i < bytes / PAGE; i++) {
    size_t p = page_of(start) + i;
    if (!os_page[p].committed) fail("decommit of a page that is not committed", start + i * PAGE);
    os_page[p].committed = 0;
  }
  decommits++;
}
static long long os_protect(uintptr_t start, size_t bytes, uint32_t prot) {
  one_block("protect that goes on into another block", start, bytes);
  for (size_t i = 0; i < bytes / PAGE; i++) {
    size_t p = page_of(start) + i;
    if (!os_page[p].committed) fail("protect of a page that is not committed", start + i * PAGE);
    os_page[p].prot = (unsigned char)prot;
  }
  return 0;
}

#include "../host/memory.h"

/* What the image may expect, page by page. */
static struct { unsigned char mapped, prot, stamp; } want[SPACE_PAGES];

static unsigned long long seed_state;
static unsigned long random_below(unsigned long n) {
  seed_state = seed_state * 6364136223846793005ull + 1442695040888963407ull;
  return (unsigned long)((seed_state >> 33) % n);
}

/* The image reads or writes a page: a fault handler would ask model_fault() first. */
static int access_page(size_t p, int write, unsigned char stamp) {
  uintptr_t address = SPACE_BASE + p * PAGE + 123;
  int allowed = want[p].mapped && (write ? want[p].prot & L_PROT_WRITE : want[p].prot != 0);
  if (!os_page[p].committed || (write ? !(os_page[p].prot & L_PROT_WRITE) : !os_page[p].prot)) {
    int handled = model_fault(address, write, 0);
    if (handled != allowed) fail(allowed ? "model_fault refused a page that the image may use" : "model_fault took a fault that is the image's", address);
    if (!handled) return 0;
    if (!os_page[p].committed) fail("model_fault said yes and the page is not committed", address);
  } else if (!allowed) fail("a page is usable that the image may not use", address);
  if (!allowed) return 0;
  if (os_page[p].stamp != want[p].stamp) fail("content of a page", address);
  if (write) os_page[p].stamp = want[p].stamp = stamp;
  return 1;
}

static void check(void) {
  for (size_t i = 0; i < region_count; i++) {
    if (regions[i].start >= regions[i].end) fail("empty range in the table", regions[i].start);
    if (i && regions[i - 1].end > regions[i].start) fail("ranges overlap or are not sorted", regions[i].start);
    if (i && regions[i - 1].end == regions[i].start && regions[i - 1].prot == regions[i].prot && regions[i - 1].flags == regions[i].flags) fail("neighbours that are alike are not joined", regions[i].start);
  }
  for (size_t i = 0; i < block_count; i++) {
    if (blocks[i].base % 0x10000 || blocks[i].size % 0x10000) fail("block that is not on 64 KiB boundaries", blocks[i].base);
    if (!region_overlaps(blocks[i].base, blocks[i].base + blocks[i].size)) fail("block without a range was not released", blocks[i].base);
  }
  for (size_t p = 0; p < SPACE_PAGES; p++) {
    uintptr_t address = SPACE_BASE + p * PAGE;
    struct region *r = region_at(address);
    if (!!r != want[p].mapped) { fail(r ? "the table has a page that is not mapped" : "the table lost a page", address); continue; }
    if (!r) {
      if (os_page[p].committed) fail("a page that is not mapped is committed", address);
      continue;
    }
    if (r->prot != want[p].prot) fail("protection in the table", address);
    if (!!(r->flags & R_COMMITTED) != os_page[p].committed) fail("the table and the system disagree about commit", address);
    if (os_page[p].committed && os_page[p].prot != r->prot) fail("protection of a committed page", address);
    if (!os_page[p].committed && want[p].stamp) fail("a page with content is not committed", address);
    if (!os_page[p].committed && r->prot && !(r->flags & R_LAZY)) fail("a usable page is neither committed nor lazy", address);
  }
}

/* More ranges than the first table holds (1024): the table grows, and nothing is lost. */
static void many_ranges(void) {
  size_t pages = 3072;
  long long r = model_map(SPACE_BASE, pages * PAGE, L_PROT_READ | L_PROT_WRITE, L_MAP_PRIVATE | L_MAP_ANONYMOUS | L_MAP_FIXED, R_ANON);
  if (r != (long long)SPACE_BASE) { fail("map for many ranges", SPACE_BASE); return; }
  for (size_t i = 0; i < pages; i++) { want[i].mapped = 1; want[i].prot = L_PROT_READ | L_PROT_WRITE; want[i].stamp = 0; }
  for (size_t i = 0; i < pages; i++) access_page(i, 1, (unsigned char)(1 + i % 250));
  for (size_t i = 1; i < pages; i += 2) {
    if (model_protect(SPACE_BASE + i * PAGE, PAGE, L_PROT_READ)) fail("protect of one page of many", SPACE_BASE + i * PAGE);
    want[i].prot = L_PROT_READ;
  }
  if (region_count != pages) fail("every page is a range of its own", region_count);
  if (region_capacity < pages) fail("the table did not grow", region_capacity);
  check();
  for (size_t i = 0; i < pages; i++) access_page(i, 0, 0);
  if (model_unmap(SPACE_BASE, pages * PAGE)) fail("unmap of many ranges", SPACE_BASE);
  for (size_t i = 0; i < pages; i++) want[i].mapped = want[i].prot = want[i].stamp = 0;
  if (region_count || block_count) fail("ranges or blocks are left", region_count + block_count);
  check();
}

int main(int argc, char **argv) {
  long operations = argc > 1 ? atol(argv[1]) : 200000;
  seed_state = argc > 2 ? strtoull(argv[2], 0, 0) : 1;
  many_ranges();
  static const uint32_t prots[] = {0, L_PROT_READ, L_PROT_READ | L_PROT_WRITE, L_PROT_READ | L_PROT_WRITE | L_PROT_EXEC};
  unsigned long maps = 0, fixed = 0, unmaps = 0, protects = 0, discards = 0, accesses = 0, touches = 0;
  for (long n = 0; n < operations && failures < 20; n++) {
    size_t p = random_below(SPACE_PAGES), pages = 1 + random_below(random_below(4) ? 24 : 200);
    if (p + pages > SPACE_PAGES) pages = SPACE_PAGES - p;
    uintptr_t address = SPACE_BASE + p * PAGE;
    uint32_t prot = prots[random_below(4)];
    long long flags = L_MAP_PRIVATE | L_MAP_ANONYMOUS | (random_below(2) ? L_MAP_NORESERVE : 0);
    switch (random_below(9)) {
      case 0: {
        long long r = model_map(random_below(3) ? 0 : (address & ~0xffffull), pages * PAGE, prot, flags, R_ANON);
        if (r < 0) break;
        maps++;
        for (size_t i = 0; i < pages; i++) {
          size_t q = page_of((uintptr_t)r) + i;
          if (want[q].mapped) fail("a new mapping is on top of a page of the image", (unsigned long long)r + i * PAGE);
          want[q].mapped = 1; want[q].prot = (unsigned char)prot; want[q].stamp = 0;
        }
        break;
      }
      case 1: {
        /* MAP_FIXED: Linux lets it be anywhere. The model needs the parts that are in no block
           yet to start on a 64 KiB boundary, so the test asks for what an image asks for:
           ranges inside of what it mapped before, or at such a boundary. */
        if (!want[p].mapped) address &= ~0xffffull, p = page_of(address);
        int possible = 1;
        for (size_t i = 0; i < pages && possible; i++)
          if (!os_page[p + i].reserved && (i == 0 ? (address % 0x10000) != 0 : os_page[p + i - 1].reserved && ((address + i * PAGE) % 0x10000) != 0)) possible = 0;
        long long r = model_map(address, pages * PAGE, prot, flags | L_MAP_FIXED, R_ANON);
        if (r < 0) {
          if (possible && r != -L_ENOMEM) fail("map fixed refused", address);
          break;
        }
        fixed++;
        for (size_t i = 0; i < pages; i++) { want[p + i].mapped = 1; want[p + i].prot = (unsigned char)prot; want[p + i].stamp = 0; }
        break;
      }
      case 2:
        if (model_unmap(address, pages * PAGE)) fail("unmap refused", address);
        unmaps++;
        for (size_t i = 0; i < pages; i++) want[p + i].mapped = want[p + i].prot = want[p + i].stamp = 0;
        break;
      case 3: {
        int covered = 1;
        for (size_t i = 0; i < pages; i++) covered &= want[p + i].mapped;
        long long r = model_protect(address, pages * PAGE, prot);
        if ((r == 0) != covered) fail(covered ? "protect refused" : "protect of pages that are not mapped was accepted", address);
        if (r) break;
        protects++;
        for (size_t i = 0; i < pages; i++) want[p + i].prot = (unsigned char)prot;
        break;
      }
      case 4:
        if (model_discard(address, pages * PAGE)) fail("discard refused", address);
        discards++;
        for (size_t i = 0; i < pages; i++) want[p + i].stamp = 0;
        break;
      case 5:
        model_touch(address + 17, pages * PAGE - 17);
        touches++;
        for (size_t i = 0; i < pages; i++)
          if (want[p + i].mapped && want[p + i].prot && !os_page[p + i].committed) fail("touch left a usable page without commit", address + i * PAGE);
        break;
      default:
        for (size_t i = 0; i < pages && i < 8; i++) accesses += (unsigned long)access_page(p + i, (int)random_below(2), (unsigned char)(1 + random_below(250)));
        break;
    }
    check();
  }
  printf("memory_model: %ld operations (map %lu, map fixed %lu, unmap %lu, protect %lu, discard %lu, touch %lu, page accesses %lu), "
         "%lu commits, %lu decommits, %zu ranges and %zu blocks at the end, %d failures\n",
         operations, maps, fixed, unmaps, protects, discards, touches, accesses, commits, decommits, region_count, block_count, failures);
  return failures ? 1 : 42;
}
