# gdb script: like measure.py in insns mode, but counts the instructions per function for one call.
import bisect
import os
import subprocess

import gdb

SYMBOL = os.environ["MEASURE_SYMBOL"]
SKIP = int(os.environ.get("MEASURE_SKIP", "100"))
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set print thread-events off")
gdb.execute("set language c")
for signal in ("SIGUSR1", "SIGUSR2", "SIGPWR", "SIGXCPU", "SIGSEGV", "SIGBUS", "SIGPIPE", "SIGCHLD"):
    gdb.execute(f"handle {signal} nostop noprint pass", to_string=True)
exe = gdb.objfiles()[0].filename
out = subprocess.run(["llvm-nm", "--defined-only", "-n", exe], capture_output=True, text=True, check=True).stdout
starts, names = [], []
for line in out.splitlines():
    parts = line.split(" ", 2)
    if len(parts) == 3 and parts[1] in "tTwW":
        starts.append(int(parts[0], 16))
        names.append(parts[2])
table = dict(zip(names, starts))
gdb.execute("starti", to_string=True)
base = 0
if b"DYN" in subprocess.run(["llvm-readelf", "-h", exe], capture_output=True, check=True).stdout:
    for line in gdb.execute("info proc mappings", to_string=True).splitlines():
        fields = line.split()
        if len(fields) >= 5 and fields[-1] == exe:
            base = int(fields[0], 16)
            break


def reg(name):
    return int(gdb.selected_frame().read_register(name)) & 0xFFFFFFFFFFFFFFFF


entry_address = base + table[SYMBOL]
entry = gdb.Breakpoint(f"*{entry_address:#x}", internal=True)
entry.ignore_count = SKIP
gdb.execute("continue", to_string=True)
main_thread = gdb.selected_thread().num
sp0 = reg("rsp")
counts = {}
total = 0
while True:
    pc = reg("rip") - base
    at = bisect.bisect_right(starts, pc) - 1
    name = names[at] if at >= 0 else "?"
    counts[name] = counts.get(name, 0) + 1
    total += 1
    gdb.execute("stepi", to_string=True)
    if gdb.selected_thread().num == main_thread and reg("rsp") > sp0:
        break
print(f"TOTAL {total}")
for name, count in sorted(counts.items(), key=lambda item: -item[1])[:25]:
    print(f"{count:6d} {name[:150]}")
gdb.execute("kill", to_string=True)
