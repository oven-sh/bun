#!/usr/bin/env python3
# reprl.py [--repeat N] [--quiet] <bun> <arguments of bun ..> -- <program files ..>: speaks Fuzzilli's protocol to one child: sends each program, prints how it ended and how long it took.
import os, sys, struct, time, mmap, resource, signal
a = sys.argv[1:]; repeat = 1; quiet = False
while a and a[0].startswith("--"):
    if a[0] == "--repeat": repeat = int(a[1]); a = a[2:]
    elif a[0] == "--quiet": quiet = True; a = a[1:]
    else: break
cut = a.index("--"); command, files = a[:cut], a[cut + 1:]
SIZE = 16 << 20
def start():
    cr, pw = os.pipe(); pr, cw = os.pipe()          # child reads control from cr, writes to cw
    data = os.memfd_create("data"); os.ftruncate(data, SIZE); out = os.memfd_create("out"); os.ftruncate(out, SIZE)
    pid = os.fork()
    if pid == 0:
        for src, dst in ((cr, 100), (cw, 101), (data, 102), (out, 103)): os.dup2(src, dst, inheritable=True)
        os.execv(command[0], command)
    os.close(cr); os.close(cw)
    assert os.read(pr, 4) == b"HELO", "no greeting"; os.write(pw, b"HELO")
    return pid, pr, pw, mmap.mmap(data, SIZE)
child = None; done = 0; began = time.time(); kinds = {}
for _ in range(repeat):
    for f in files:
        if child is None: child = start()
        pid, pr, pw, m = child
        text = open(f, "rb").read(); m[:len(text)] = text
        t = time.time(); os.write(pw, b"exec" + struct.pack("<Q", len(text)))
        reply = os.read(pr, 4)
        if len(reply) == 4: status = struct.unpack("<I", reply)[0]; how = "SIGNAL %d" % (status & 255) if status & 255 else "exit %d" % (status >> 8)
        else:
            _, status = os.waitpid(pid, 0); how = "SIGNAL %d" % os.WTERMSIG(status) if os.WIFSIGNALED(status) else "ENDED %d" % os.WEXITSTATUS(status); child = None
        done += 1; kinds[how] = kinds.get(how, 0) + 1
        if not quiet: print("%-10s %7.0f ms  %s" % (how, (time.time() - t) * 1000, f), flush=True)
wall = time.time() - began; u = resource.getrusage(resource.RUSAGE_CHILDREN)
if child: os.kill(child[0], signal.SIGKILL); os.waitpid(child[0], 0); u = resource.getrusage(resource.RUSAGE_CHILDREN)
print("%d programs in %.1f s wall, %.1f s processor time: %.2f a second of wall, %.2f a second of processor time; peak %d MB; %s" % (done, wall, u.ru_utime + u.ru_stime, done / wall, done / max(u.ru_utime + u.ru_stime, 1e-9), u.ru_maxrss >> 10, kinds))
