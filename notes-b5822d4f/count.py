# gdb -q -batch -readnever -x count.py --args <binary> <args...>
# Counts the calls of the functions in $COUNT_SYMS ("label=0xaddr,label=0xaddr").
import gdb, os
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set breakpoint pending on")
gdb.execute("set startup-with-shell off")
for sig in ("SIGPIPE", "SIGUSR1", "SIGPWR", "SIGXCPU", "SIGSEGV"):
    gdb.execute("handle %s nostop noprint pass" % sig)
gdb.execute("set follow-fork-mode parent")
gdb.execute("set detach-on-fork on")
counts = {}
class CountBP(gdb.Breakpoint):
    def __init__(self, addr, label):
        super().__init__("*" + addr, internal=True)
        self.label = label
        counts[label] = 0
    def stop(self):
        counts[self.label] += 1
        return False
for item in os.environ["COUNT_SYMS"].split(","):
    label, addr = item.split("=")
    CountBP(addr, label)
gdb.execute("run")
print("COUNTS " + " ".join("%s=%d" % kv for kv in sorted(counts.items())))
