#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/openat2.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>
static const char *res(long r) { static char b[64]; if (r >= 0) { close(r); return "ok"; } snprintf(b, sizeof b, "%s", strerrorname_np(errno)); return b; }
static long o2(int dir, const char *p, int flags, int mode) {
  struct open_how how = {.flags = flags | O_CLOEXEC, .mode = (flags & O_CREAT) ? mode : 0, .resolve = RESOLVE_NO_SYMLINKS};
  return syscall(SYS_openat2, dir, p, &how, sizeof how);
}
int main(int argc, char **argv) {
  int dir = open(argv[1], O_RDONLY | O_DIRECTORY);
  if (dir < 0) { perror("open dir"); return 1; }
  printf("uid %d in %s\n", getuid(), argv[1]);
  printf("  openat2 NO_SYMLINKS  link/f  O_CREAT : %s\n", res(o2(dir, "link/f", O_WRONLY | O_CREAT | O_TRUNC, 0644)));
  printf("  openat2 NO_SYMLINKS  link    O_PATH|O_DIRECTORY : %s\n", res(o2(dir, "link", O_PATH | O_DIRECTORY, 0)));
  printf("  openat2 NO_SYMLINKS  leaf    O_CREAT : %s\n", res(o2(dir, "leaf", O_WRONLY | O_CREAT | O_TRUNC, 0644)));
  printf("  openat  O_NOFOLLOW   leaf    O_CREAT : %s\n", res(openat(dir, "leaf", O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW | O_CLOEXEC, 0644)));
  printf("  openat  O_NOFOLLOW   link    O_PATH|O_DIRECTORY : %s\n", res(openat(dir, "link", O_PATH | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)));
  printf("  openat  (follows)    link/f  O_CREAT : %s\n", res(openat(dir, "link/f", O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0644)));
  struct stat st; printf("  fstatat NOFOLLOW     link : %s\n", fstatat(dir, "link", &st, AT_SYMLINK_NOFOLLOW) == 0 ? (S_ISLNK(st.st_mode) ? "symlink" : "other") : strerrorname_np(errno));
  printf("  unlinkat             leaf : %s\n", unlinkat(dir, "leaf", 0) == 0 ? "removed" : strerrorname_np(errno));
  return 0;
}
