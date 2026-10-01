// Replays the syscall sequence of an extractor design over a member list.
// usage: replay <mode> <list> <dest> <0|1>     mode: main | atomic | proof | slot
// list lines: "f <path>" | "d <path>" | "l <path> <target>"
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

static int root;
static long n_eloop;

static int oa2(int dfd, const char *p, int flags, int mode) {
  struct open_how how = {.flags = (unsigned long long)(flags | O_CLOEXEC), .mode = (flags & O_CREAT) ? mode : 0, .resolve = RESOLVE_NO_SYMLINKS};
  return (int)syscall(SYS_openat2, dfd, p, &how, sizeof how);
}
static const char *base_of(const char *p) { const char *s = strrchr(p, '/'); return s ? s + 1 : p; }
// dirname into buf; returns 0 if no dirname
static int dir_of(const char *p, char *buf) { const char *s = strrchr(p, '/'); if (!s) return 0; memcpy(buf, p, s - p); buf[s - p] = 0; return 1; }

// ---- main's make_path (multi-component mkdirat on root, back-then-forward)
static void main_make_path(const char *dir) {
  char buf[4096]; size_t len = strlen(dir); size_t ends[256]; int n = 0;
  for (size_t i = 0; i <= len; i++) if (dir[i] == '/' || dir[i] == 0) ends[n++] = i;
  int k = n - 1;
  for (;;) {
    memcpy(buf, dir, ends[k]); buf[ends[k]] = 0;
    if (mkdirat(root, buf, 0755) == 0 || errno == EEXIST) { if (++k == n) return; }
    else if (errno == ENOENT) { if (--k < 0) return; }
    else return;
  }
}

// ---- hybrid: one-slot parent fd (only used in slot mode)
static int slot_fd = -1; static char slot_path[4096]; static int use_slot;
static void slot_drop(void) { if (slot_fd >= 0) { close(slot_fd); slot_fd = -1; } }

// returns fd for directory `dir` (resolved with no symlinks), or root if dir is empty. *owned tells whether to close.
static int open_parent(const char *dir, int *owned) {
  if (!dir[0]) { *owned = 0; return root; }
  if (use_slot && slot_fd >= 0 && strcmp(slot_path, dir) == 0) { *owned = 0; return slot_fd; }
  int fd = oa2(root, dir, O_PATH | O_DIRECTORY, 0);
  if (fd < 0) return -1;
  if (use_slot) { slot_drop(); slot_fd = fd; strcpy(slot_path, dir); *owned = 0; return fd; }
  *owned = 1; return fd;
}
// create every missing component of `dir` by single name, never following a link. Returns 0 on success.
static int atomic_make_parents(const char *dir) {
  char buf[4096]; size_t len = strlen(dir); size_t starts[256], ends[256]; int n = 0; size_t st = 0;
  for (size_t i = 0; i <= len; i++) if (dir[i] == '/' || dir[i] == 0) { starts[n] = st; ends[n++] = i; st = i + 1; }
  // find deepest existing ancestor: prefix of k components, k from n-1 down to 0 (0 = root)
  int k = n - 1, p = root, owned = 0;
  for (; k > 0; k--) {
    memcpy(buf, dir, ends[k - 1]); buf[ends[k - 1]] = 0;
    int fd = open_parent(buf, &owned);
    if (fd >= 0) { p = fd; break; }
    if (errno != ENOENT) return -1;
  }
  if (k == 0) { p = root; owned = 0; }
  for (int i = k; i < n; i++) {
    char name[256]; memcpy(name, dir + starts[i], ends[i] - starts[i]); name[ends[i] - starts[i]] = 0;
    if (mkdirat(p, name, 0755) != 0 && errno != EEXIST) { if (owned) close(p); return -1; }
    if (i + 1 < n) {
      int q = openat(p, name, O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
      if (owned) close(p);
      if (q < 0) return -1;
      p = q; owned = 1;
    }
  }
  if (owned) close(p);
  return 0;
}

static void put(int fd) { if (fd < 0) { perror("open"); exit(1); } if (pwrite(fd, "x=1;\n", 5, 0) != 5) { perror("pwrite"); exit(1); } close(fd); }

struct link { char path[512], target[256]; };
static struct link *links; static int nlinks;

int main(int argc, char **argv) {
  if (argc < 5) return 2;
  const char *mode = argv[1]; int extract = atoi(argv[4]);
  int is_main = !strcmp(mode, "main"), is_proof = !strcmp(mode, "proof");
  use_slot = !strcmp(mode, "slot");
  FILE *f = fopen(argv[2], "r"); if (!f) return 3;
  static char line[2048]; char **ls = NULL; size_t nl = 0, cap = 0;
  while (fgets(line, sizeof line, f)) { line[strcspn(line, "\n")] = 0; if (nl == cap) { cap = cap ? cap * 2 : 4096; ls = realloc(ls, cap * sizeof *ls); } ls[nl++] = strdup(line); }
  fclose(f);
  links = malloc(sizeof(struct link) * (nl + 1));
  if (!extract) return 0;
  mkdir(argv[3], 0755);
  root = open(argv[3], O_RDONLY | O_DIRECTORY | O_CLOEXEC);
  if (root < 0) { perror("root"); return 4; }
  const int W = O_WRONLY | O_CREAT | O_TRUNC;
  char dir[4096];
  for (size_t i = 0; i < nl; i++) {
    char kind = ls[i][0]; char *path = ls[i] + 2;
    if (kind == 'f') {
      int fd;
      if (is_main) {
        fd = openat(root, path, W | O_CLOEXEC, 0666);
        if (fd < 0 && errno == ENOENT && dir_of(path, dir)) { main_make_path(dir); fd = openat(root, path, W | O_CLOEXEC, 0666); }
      } else {
        fd = oa2(root, path, W, 0666);
        if (fd < 0 && errno == ENOENT && dir_of(path, dir)) {
          if (is_proof) main_make_path(dir); else if (atomic_make_parents(dir) != 0) { perror("parents"); return 5; }
          fd = oa2(root, path, W, 0666);
        } else if (fd < 0 && errno == ELOOP) {
          n_eloop++;
          int owned = 0, p = root;
          if (dir_of(path, dir)) p = open_parent(dir, &owned);
          if (p < 0) { fprintf(stderr, "REJECT parent link: %s\n", path); return 40; }
          unlinkat(p, base_of(path), 0);
          fd = openat(p, base_of(path), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0666);
          if (owned) close(p);
        }
      }
      put(fd);
    } else if (kind == 'd') {
      size_t L = strlen(path); if (L && path[L - 1] == '/') path[L - 1] = 0;
      if (is_main) {
        if (mkdirat(root, path, 0755) != 0 && errno != EEXIST && errno != ENOTDIR && dir_of(path, dir)) { main_make_path(dir); mkdirat(root, path, 0777); }
      } else {
        int owned = 0, p = root;
        if (dir_of(path, dir)) {
          p = open_parent(dir, &owned);
          if (p < 0 && errno == ENOENT) { if (atomic_make_parents(dir) != 0) return 6; p = open_parent(dir, &owned); }
          if (p < 0) { fprintf(stderr, "REJECT parent link (dir): %s\n", path); return 41; }
        }
        if (mkdirat(p, base_of(path), 0755) != 0 && errno != EEXIST) { perror("mkdirat"); return 7; }
        if (owned) close(p);
      }
    } else if (kind == 'l') {
      char *sp = strchr(path, ' '); *sp = 0;
      strcpy(links[nlinks].path, path); strcpy(links[nlinks].target, sp + 1); nlinks++;
    }
  }
  // deferred symlinks
  if (is_main) {
    struct stat *exp = malloc(sizeof(struct stat) * (nlinks + 1)); char *has = calloc(nlinks + 1, 1);
    for (int i = 0; i < nlinks; i++) {
      if (!dir_of(links[i].path, dir)) continue;
      main_make_path(dir);
      int fd = openat(root, dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
      if (fd >= 0) { if (fstat(fd, &exp[i]) == 0) has[i] = 1; close(fd); }
    }
    for (int i = 0; i < nlinks; i++) {
      if (!dir_of(links[i].path, dir)) { symlinkat(links[i].target, root, links[i].path); continue; }
      int fd = openat(root, dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC); struct stat st;
      if (fd >= 0 && fstat(fd, &st) == 0 && has[i] && st.st_dev == exp[i].st_dev && st.st_ino == exp[i].st_ino) symlinkat(links[i].target, fd, base_of(links[i].path));
      if (fd >= 0) close(fd);
    }
  } else {
    for (int i = 0; i < nlinks; i++) {
      int owned = 0, p = root;
      if (dir_of(links[i].path, dir)) {
        p = open_parent(dir, &owned);
        if (p < 0 && errno == ENOENT) { if (atomic_make_parents(dir) != 0) return 8; p = open_parent(dir, &owned); }
        if (p < 0) continue;
      }
      symlinkat(links[i].target, p, base_of(links[i].path));
      if (owned) close(p);
    }
  }
  slot_drop();
  close(root);
  if (n_eloop) fprintf(stderr, "eloop=%ld\n", n_eloop);
  return 0;
}
