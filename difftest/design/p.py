import ctypes, os, errno, struct
libc = ctypes.CDLL(None, use_errno=True)
SYS_openat2 = 437
RESOLVE_NO_SYMLINKS = 0x04
RESOLVE_BENEATH = 0x08
def openat2(dirfd, path, flags, mode, resolve):
    how = struct.pack("QQQ", flags, mode, resolve)
    r = libc.syscall(SYS_openat2, dirfd, path.encode(), how, len(how))
    if r < 0:
        return "E:" + errno.errorcode[ctypes.get_errno()]
    os.close(r)
    return "ok"
root = os.open("t/out", os.O_RDONLY | os.O_DIRECTORY)
W = os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_CLOEXEC
for name in ["cfg", "dang", "shared/f.txt", "inside/x.txt", "real/sub/new.txt", "real/missing/new.txt", "afile/x", "real", "plain.txt"]:
    print(f"{name:24} NO_SYMLINKS={openat2(root, name, W, 0o644, RESOLVE_NO_SYMLINKS):10} BENEATH={openat2(root, name, W, 0o644, RESOLVE_BENEATH)}")
print("victim:", open("t/victim/f.txt").read().strip(), "| victim dir:", sorted(os.listdir("t/victim")))
