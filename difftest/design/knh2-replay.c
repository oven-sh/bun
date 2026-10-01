// Replays the syscall sequence of an extractor design over a member listing.
// Modes: main (default extractor at bf42a525d5), globmain (glob extractor at bf42a525d5),
//        hyb (kernel-nofollow-open-hybrid, atomic variant, nothing kept between entries),
//        hyb1 (same + one-slot parent fd), proof (ENOENT-as-proof variant: main's make_path after ENOENT),
//        walk (fallback: uncached per-component O_NOFOLLOW walk, #31585 shape, leaf O_NOFOLLOW).
// Counts the syscalls it issues itself (by wrapper) so the numbers are extraction-only.
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <linux/openat2.h>

static long n_openat, n_openat2, n_close, n_mkdirat, n_pwrite, n_symlinkat, n_unlinkat, n_fstat, n_failed;
static long n_err_alloc; // failed calls through bun_sys wrappers that attach a path (one Box<[u8]> each)

static int x_openat(int d, const char *p, int fl, int mode) { n_openat++; int r = (int)syscall(SYS_openat, d, p, fl, mode); if (r < 0) { n_failed++; n_err_alloc++; } return r; }
static int x_openat2(int d, const char *p, int fl, int mode, unsigned long res) {
  struct open_how how = { .flags = (unsigned long)fl, .mode = (fl & O_CREAT) ? (unsigned long)mode : 0, .resolve = res };
  n_openat2++; int r = (int)syscall(SYS_openat2, d, p, &how, sizeof(how)); if (r < 0) { n_failed++; n_err_alloc++; } return r; }
static int x_close(int fd) { n_close++; return close(fd); }
static int x_mkdirat(int d, const char *p, int mode) { n_mkdirat++; int r = mkdirat(d, p, mode); if (r < 0) { n_failed++; n_err_alloc++; } return r; }
static long x_pwrite(int fd, const void *b, size_t n, off_t o) { n_pwrite++; return pwrite(fd, b, n, o); }
static int x_symlinkat(const char *t, int d, const char *p) { n_symlinkat++; int r = symlinkat(t, d, p); if (r < 0) { n_failed++; n_err_alloc++; } return r; }
static int x_unlinkat(int d, const char *p) { n_unlinkat++; int r = unlinkat(d, p, 0); if (r < 0) { n_failed++; n_err_alloc++; } return r; }
static int x_fstat(int fd, struct stat *st) { n_fstat++; return fstat(fd, st); }

#define W (O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC)
#define PDIR (O_PATH | O_DIRECTORY | O_CLOEXEC)
#define NS RESOLVE_NO_SYMLINKS

static const char *mode_name;
static long skipped, rejected, replaced;

// ---- main: mkdir -p from the root fd with whole prefixes (bun_paths::make_path_with) ----
static int main_make_path(int root, const char *sub) {
  // components
  char buf[4096]; size_t len = strlen(sub); while (len && sub[len-1] == '/') len--;
  size_t ends[256]; int n = 0;
  for (size_t i = 0; i <= len; i++) if (i == len || sub[i] == '/') { if (i > 0 && sub[i-1] != '/') ends[n++] = i; }
  if (n == 0) return 0;
  int i = n - 1;
  for (;;) {
    memcpy(buf, sub, ends[i]); buf[ends[i]] = 0;
    if (x_mkdirat(root, buf, 0755) == 0 || errno == EEXIST) { if (i == n - 1) return 0; i++; }
    else if (errno == ENOENT) { if (i == 0) return -1; i--; }
    else return -1;
  }
}

// ---- hybrid helpers ----
static char slot_path[4096]; static int slot_fd = -1; static int use_slot;
// Returns a parent fd for `dir` (relative, no trailing slash) resolved without following any symlink.
// *borrowed = 1 when the caller must not close it (root or slot).
static int hyb_open_dir(int root, const char *dir, int *borrowed) {
  if (!*dir) { *borrowed = 1; return root; }
  if (use_slot) {
    if (slot_fd >= 0 && strcmp(slot_path, dir) == 0) { *borrowed = 1; return slot_fd; }
    int fd = x_openat2(root, dir, PDIR, 0, NS);
    if (fd < 0) return -1;
    if (slot_fd >= 0) x_close(slot_fd);
    slot_fd = fd; strcpy(slot_path, dir); *borrowed = 1; return fd;
  }
  *borrowed = 0;
  return x_openat2(root, dir, PDIR, 0, NS);
}
static void hyb_slot_set(int fd, const char *dir) { if (slot_fd >= 0) x_close(slot_fd); slot_fd = fd; strcpy(slot_path, dir); }

// mkdir -p by single names: find the deepest existing prefix with one kernel-refused open per probe,
// then mkdirat(parent fd, name) and step down with openat(O_NOFOLLOW|O_DIRECTORY|O_PATH).
static int hyb_make_dirs(int root, const char *sub) {
  char buf[4096]; size_t len = strlen(sub); while (len && sub[len-1] == '/') len--;
  size_t starts[256], ends[256]; int n = 0; size_t s = 0;
  for (size_t i = 0; i <= len; i++) if (i == len || sub[i] == '/') { if (i > s) { starts[n] = s; ends[n] = i; n++; } s = i + 1; }
  if (n == 0) return 0;
  // probe prefixes of length n-1 .. 1 ; length 0 is the root
  int k = n - 1; int cur = root; int cur_borrowed = 1;
  for (; k >= 1; k--) {
    memcpy(buf, sub, ends[k-1]); buf[ends[k-1]] = 0;
    int b; int fd = hyb_open_dir(root, buf, &b);
    if (fd >= 0) { cur = fd; cur_borrowed = b; break; }
    if (errno != ENOENT) return -1; // ELOOP / ENOTDIR / EACCES go to the policy or reject
  }
  for (int i = k; i < n; i++) {
    char name[256]; size_t nl = ends[i] - starts[i]; memcpy(name, sub + starts[i], nl); name[nl] = 0;
    if (x_mkdirat(cur, name, 0755) != 0 && errno != EEXIST) { if (!cur_borrowed) x_close(cur); return -1; }
    if (i + 1 < n) {
      int next = x_openat(cur, name, PDIR | O_NOFOLLOW, 0);
      if (!cur_borrowed) x_close(cur);
      if (next < 0) return -1;
      cur = next; cur_borrowed = 0;
      if (use_slot) { memcpy(buf, sub, ends[i]); buf[ends[i]] = 0; hyb_slot_set(next, buf); cur_borrowed = 1; }
    }
  }
  if (!cur_borrowed) x_close(cur);
  return 0;
}

static void split(const char *path, char *dir, char *name) {
  size_t len = strlen(path); while (len && path[len-1] == '/') len--;
  size_t i = len; while (i > 0 && path[i-1] != '/') i--;
  memcpy(name, path + i, len - i); name[len - i] = 0;
  size_t dl = i; while (dl && path[dl-1] == '/') dl--;
  memcpy(dir, path, dl); dir[dl] = 0;
}

// ---- walk: uncached per-component O_NOFOLLOW walk (fallback where the kernel cannot refuse) ----
static int walk_parent(int root, const char *dir, int create) {
  int cur = root; const char *p = dir;
  while (*p) {
    const char *e = strchr(p, '/'); size_t l = e ? (size_t)(e - p) : strlen(p);
    char name[256]; memcpy(name, p, l); name[l] = 0;
    int next = x_openat(cur, name, PDIR | O_NOFOLLOW, 0);
    if (next < 0 && errno == ENOENT && create) {
      if (x_mkdirat(cur, name, 0755) != 0 && errno != EEXIST) { if (cur != root) x_close(cur); return -1; }
      next = x_openat(cur, name, PDIR | O_NOFOLLOW, 0);
    }
    if (cur != root) x_close(cur);
    if (next < 0) return -1;
    cur = next; p += l; while (*p == '/') p++;
  }
  return cur;
}

struct link { char path[512]; char target[256]; };
static struct link *links; static long n_links, cap_links;

static int do_file(int root, const char *path) {
  int fd = -1; char dir[4096], name[256];
  if (!strcmp(mode_name, "main") || !strcmp(mode_name, "globmain")) {
    if (!strcmp(mode_name, "globmain")) { split(path, dir, name); if (*dir) main_make_path(root, dir); fd = x_openat(root, path, W, 0666); if (fd < 0) { skipped++; return 0; } }
    else {
      fd = x_openat(root, path, W, 0666);
      if (fd < 0) {
        if (errno != ENOENT && errno != EACCES && errno != EPERM) { rejected++; return -1; }
        split(path, dir, name); if (!*dir) { rejected++; return -1; }
        main_make_path(root, dir);
        fd = x_openat(root, path, W, 0666);
        if (fd < 0) { rejected++; return -1; }
      }
    }
  } else if (!strcmp(mode_name, "walk")) {
    split(path, dir, name);
    int p = walk_parent(root, dir, 1);
    if (p < 0) { rejected++; return -1; }
    fd = x_openat(p, name, W | O_NOFOLLOW, 0666);
    if (fd < 0 && (errno == ELOOP || errno == EMLINK)) { x_unlinkat(p, name); fd = x_openat(p, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0666); replaced++; }
    if (p != root) x_close(p);
    if (fd < 0) { rejected++; return -1; }
  } else { // hyb, hyb1, proof
    fd = x_openat2(root, path, W, 0666, NS);
    if (fd < 0 && errno == ENOENT) {
      split(path, dir, name); if (!*dir) { rejected++; return -1; }
      if (!strcmp(mode_name, "proof")) main_make_path(root, dir);
      else if (hyb_make_dirs(root, dir) != 0) { rejected++; return -1; }
      fd = x_openat2(root, path, W, 0666, NS);
    }
    if (fd < 0 && errno == ELOOP) {
      split(path, dir, name);
      int b = 1; int p = hyb_open_dir(root, dir, &b);
      if (p < 0) { rejected++; return -1; } // a parent component is a link: policy (reject here)
      x_unlinkat(p, name);
      fd = x_openat(p, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0666);
      if (!b) x_close(p);
      replaced++;
    }
    if (fd < 0) { rejected++; return -1; }
  }
  x_pwrite(fd, "x\n", 2, 0);
  x_close(fd);
  return 0;
}

static int do_dir(int root, const char *path) {
  char dir[4096], name[256];
  if (!strcmp(mode_name, "main")) {
    if (x_mkdirat(root, path, 0755) != 0) {
      if (errno == EEXIST || errno == ENOTDIR) return 0;
      split(path, dir, name); if (!*dir) { rejected++; return -1; }
      main_make_path(root, dir); x_mkdirat(root, path, 0777);
    }
  } else if (!strcmp(mode_name, "globmain")) {
    main_make_path(root, path);
  } else if (!strcmp(mode_name, "walk")) {
    split(path, dir, name);
    int p = walk_parent(root, dir, 1); if (p < 0) { rejected++; return -1; }
    x_mkdirat(p, name, 0755); if (p != root) x_close(p);
  } else if (!strcmp(mode_name, "proof")) {
    // directory entries have no open to prove the prefix; they need the parent fd like hyb
    split(path, dir, name);
    int b = 1; int p = hyb_open_dir(root, dir, &b);
    if (p < 0 && errno == ENOENT) { main_make_path(root, dir); p = hyb_open_dir(root, dir, &b); }
    if (p < 0) { rejected++; return -1; }
    x_mkdirat(p, name, 0755); if (!b) x_close(p);
  } else {
    split(path, dir, name);
    int b = 1; int p = hyb_open_dir(root, dir, &b);
    if (p < 0 && errno == ENOENT) { if (hyb_make_dirs(root, dir) != 0) { rejected++; return -1; } p = hyb_open_dir(root, dir, &b); }
    if (p < 0) { rejected++; return -1; }
    x_mkdirat(p, name, 0755); if (!b) x_close(p);
  }
  return 0;
}

static void do_links(int root) {
  char dir[4096], name[256];
  if (!strcmp(mode_name, "main")) {
    struct stat *st = calloc(n_links + 1, sizeof(*st)); char *have = calloc(n_links + 1, 1);
    for (long i = 0; i < n_links; i++) {
      split(links[i].path, dir, name); if (!*dir) continue;
      main_make_path(root, dir);
      int fd = x_openat(root, dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
      if (fd >= 0) { x_fstat(fd, &st[i]); have[i] = 1; x_close(fd); }
    }
    for (long i = 0; i < n_links; i++) {
      split(links[i].path, dir, name);
      if (!*dir) { x_symlinkat(links[i].target, root, links[i].path); continue; }
      struct stat s2; int fd = x_openat(root, dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
      if (fd >= 0) { x_fstat(fd, &s2); if (have[i] && s2.st_ino == st[i].st_ino && s2.st_dev == st[i].st_dev) x_symlinkat(links[i].target, fd, name); x_close(fd); }
    }
    return;
  }
  for (long i = 0; i < n_links; i++) {
    split(links[i].path, dir, name);
    if (!strcmp(mode_name, "globmain")) {
      if (x_symlinkat(links[i].target, root, links[i].path) != 0 && (errno == ENOENT || errno == EPERM)) { if (*dir) main_make_path(root, dir); x_symlinkat(links[i].target, root, links[i].path); }
      continue;
    }
    if (!strcmp(mode_name, "walk")) {
      int p = walk_parent(root, dir, 1); if (p < 0) { skipped++; continue; }
      x_symlinkat(links[i].target, p, name); if (p != root) x_close(p); continue;
    }
    int b = 1; int p = hyb_open_dir(root, dir, &b);
    if (p < 0 && errno == ENOENT) { if (!strcmp(mode_name, "proof")) main_make_path(root, dir); else hyb_make_dirs(root, dir); p = hyb_open_dir(root, dir, &b); }
    if (p < 0) { skipped++; continue; }
    x_symlinkat(links[i].target, p, name); if (!b) x_close(p);
  }
}

int main(int argc, char **argv) {
  if (argc < 4) { fprintf(stderr, "usage: replay <mode> <list> <dest>\n"); return 2; }
  mode_name = argv[1]; use_slot = !strcmp(mode_name, "hyb1");
  if (use_slot) mode_name = "hyb";
  FILE *f = fopen(argv[2], "r"); if (!f) { perror("list"); return 2; }
  // extract_to_disk: mkdir -p root, open root
  n_mkdirat++; mkdirat(AT_FDCWD, argv[3], 0755);
  int root = x_openat(AT_FDCWD, argv[3], O_RDONLY | O_DIRECTORY | O_CLOEXEC, 0);
  if (root < 0) { perror("root"); return 2; }
  char line[5000]; int globmode = !strcmp(mode_name, "globmain"); int stop = 0;
  while (!stop && fgets(line, sizeof line, f)) {
    size_t l = strlen(line); if (l && line[l-1] == '\n') line[--l] = 0;
    char kind = line[0]; char *path = line + 2;
    if (kind == 'f') { if (do_file(root, path) != 0) stop = 1; }
    else if (kind == 'd') { if (do_dir(root, path) != 0) stop = 1; }
    else if (kind == 'l') {
      char *t = strchr(path, ' '); *t++ = 0;
      if (globmode) { // inline
        struct link one; strcpy(one.path, path); strcpy(one.target, t); links = &one; n_links = 1; do_links(root); links = NULL; n_links = 0; cap_links = 0;
      } else {
        if (n_links == cap_links) { cap_links = cap_links ? cap_links * 2 : 64; links = realloc(links, cap_links * sizeof(*links)); }
        strcpy(links[n_links].path, path); strcpy(links[n_links].target, t); n_links++;
      }
    }
  }
  if (!globmode) do_links(root);
  if (slot_fd >= 0) x_close(slot_fd);
  x_close(root);
  long sum = n_openat + n_openat2 + n_close + n_mkdirat + n_pwrite + n_symlinkat + n_unlinkat + n_fstat;
  printf("%-8s sum=%ld openat=%ld openat2=%ld close=%ld mkdirat=%ld pwrite=%ld symlinkat=%ld unlinkat=%ld fstat=%ld failed=%ld replaced=%ld rejected=%ld skipped=%ld\n",
         argv[1], sum, n_openat, n_openat2, n_close, n_mkdirat, n_pwrite, n_symlinkat, n_unlinkat, n_fstat, n_failed, replaced, rejected, skipped);
  return 0;
}
