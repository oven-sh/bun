import ctypes, os, errno, struct, shutil
libc = ctypes.CDLL(None, use_errno=True)
SYS_openat2 = 437
RESOLVE_NO_SYMLINKS = 0x04
RESOLVE_BENEATH = 0x08
O_PATH = 0o10000000
def openat2(dfd, path, flags, mode=0, resolve=RESOLVE_NO_SYMLINKS):
    how = struct.pack("QQQ", flags | os.O_CLOEXEC, mode, resolve)
    r = libc.syscall(SYS_openat2, dfd, path.encode(), how, len(how))
    if r < 0:
        return errno.errorcode[ctypes.get_errno()]
    os.close(r)
    return "OK"
base = "/tmp/acct1-knh/kp"
shutil.rmtree(base, ignore_errors=True)
os.makedirs(base + "/out/real/sub")
os.makedirs(base + "/victim")
open(base + "/victim/f.txt", "w").write("ORIGINAL")
open(base + "/out/file", "w").write("x")
os.symlink("../victim/f.txt", base + "/out/cfg")
os.symlink("../victim/nowhere", base + "/out/dang")
os.symlink("../victim", base + "/out/shared")
os.symlink("real", base + "/out/inside")
os.symlink("../victim", base + "/out/dirlink")
root = os.open(base + "/out", os.O_RDONLY | os.O_DIRECTORY)
W = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
cases = [
 ("leaf link to file", "cfg", W),
 ("leaf dangling link", "dang", W),
 ("leaf link to dir", "dirlink", W),
 ("parent link outside", "shared/f.txt", W),
 ("parent link inside", "inside/f.txt", W),
 ("parent link + missing comp", "shared/x/y/f.txt", W),
 ("missing parent", "nope/f.txt", W),
 ("missing 2 parents", "nope/n2/f.txt", W),
 ("file in the way", "file/f.txt", W),
 ("file over dir", "real", W),
 ("new file in existing dir", "real/sub/new.txt", W),
 ("existing file", "file", W),
 ("parent O_PATH existing", "real/sub", O_PATH | os.O_DIRECTORY),
 ("parent O_PATH link", "inside", O_PATH | os.O_DIRECTORY),
 ("parent O_PATH under link", "inside/sub", O_PATH | os.O_DIRECTORY),
 ("parent O_PATH missing", "nope", O_PATH | os.O_DIRECTORY),
 ("parent O_PATH file", "file", O_PATH | os.O_DIRECTORY),
 ("parent O_PATH leaf link no O_DIRECTORY", "inside", O_PATH),
]
for name, p, fl in cases:
    print(f"{name:40s} {p:22s} -> {openat2(root, p, fl, 0o644)}")
print("victim:", open(base + "/victim/f.txt").read(), sorted(os.listdir(base + "/victim")))
# plain O_NOFOLLOW|O_DIRECTORY for comparison
for p in ("inside", "file", "nope"):
    try:
        fd = os.open(p, os.O_PATH | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root); os.close(fd); r = "OK"
    except OSError as e:
        r = errno.errorcode[e.errno]
    print("plain O_PATH|O_DIRECTORY|O_NOFOLLOW", p, "->", r)
