import ctypes, os, errno, struct, shutil, sys
libc = ctypes.CDLL(None, use_errno=True)
SYS_openat2 = 437
RESOLVE_NO_SYMLINKS = 0x04
RESOLVE_BENEATH = 0x08
O_PATH = 0o10000000
def openat2(dfd, path, flags, mode=0, resolve=RESOLVE_NO_SYMLINKS):
    how = struct.pack("QQQ", flags | os.O_CLOEXEC, mode, resolve)
    buf = ctypes.create_string_buffer(how)
    r = libc.syscall(SYS_openat2, dfd, path.encode(), buf, len(how))
    if r < 0:
        return errno.errorcode[ctypes.get_errno()]
    os.close(r)
    return "ok"
base = "/tmp/rev1-knh/t"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/out/real/sub"); os.makedirs(base + "/victim")
open(base + "/victim/f.txt", "w").write("ORIGINAL")
open(base + "/out/plainfile", "w").write("x")
os.symlink("../victim/f.txt", base + "/out/cfg")
os.symlink("../victim/new.txt", base + "/out/dang")
os.symlink("../victim", base + "/out/shared")
os.symlink("real", base + "/out/inside")
os.symlink(".", base + "/out/d1")
root = os.open(base + "/out", os.O_RDONLY | os.O_DIRECTORY)
W = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
cases = [
 ("leaf link to file", "cfg", W),
 ("dangling leaf link", "dang", W),
 ("parent link outside", "shared/f.txt", W),
 ("parent link outside + missing dir after", "shared/nope/f.txt", W),
 ("parent link inside", "inside/f.txt", W),
 ("missing dir BEFORE link name (a/shared/..)", "nope/shared/f.txt", W),
 ("d1 -> . chain", "d1/real/x.txt", W),
 ("missing parent", "real/nope/f.txt", W),
 ("file in the way", "plainfile/f.txt", W),
 ("file over directory", "real", W),
 ("plain nested create", "real/sub/ok.txt", W),
 ("parent open O_PATH|O_DIRECTORY real/sub", "real/sub", O_PATH | os.O_DIRECTORY),
 ("parent open through link", "inside/sub", O_PATH | os.O_DIRECTORY),
 ("parent open: name is a link", "shared", O_PATH | os.O_DIRECTORY),
 ("parent open: name is a file", "plainfile", O_PATH | os.O_DIRECTORY),
 ("O_EXCL create over leaf link", "cfg", os.O_WRONLY | os.O_CREAT | os.O_EXCL),
]
for label, p, fl in cases:
    print(f"{label:48s} {p:22s} -> {openat2(root, p, fl, 0o644)}")
print("victim:", open(base + "/victim/f.txt").read(), "| victim dir:", sorted(os.listdir(base + "/victim")))
# plain openat for comparison on the same shapes (what main issues)
for p in ["cfg", "shared/f2.txt"]:
    try:
        fd = os.open(p, W, 0o644, dir_fd=root); os.close(fd); print("plain openat", p, "-> ok")
    except OSError as e:
        print("plain openat", p, "->", errno.errorcode[e.errno])
print("victim after plain:", open(base + "/victim/f.txt").read(), "| victim dir:", sorted(os.listdir(base + "/victim")))
