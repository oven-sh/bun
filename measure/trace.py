# gdb script: prints the instructions that one call executes inside MEASURE_FUNC (offset and text), in order.
import os
import subprocess

import gdb

SYMBOL = os.environ["MEASURE_SYMBOL"]
FUNC = os.environ["MEASURE_FUNC"]
SKIP = int(os.environ.get("MEASURE_SKIP", "100"))
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set print thread-events off")
gdb.execute("set language c")
for signal in ("SIGUSR1", "SIGUSR2", "SIGPWR", "SIGXCPU", "SIGSEGV", "SIGBUS", "SIGPIPE", "SIGCHLD"):
    gdb.execute(f"handle {signal} nostop noprint pass", to_string=True)
exe = gdb.objfiles()[0].filename
out = subprocess.run(["llvm-nm", "-S", "--defined-only", exe], capture_output=True, text=True, check=True).stdout
table = {}
for line in out.splitlines():
    parts = line.split(" ", 3)
    if len(parts) == 4:
        table.setdefault(parts[3], (int(parts[0], 16), int(parts[1], 16)))
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


entry_address = base + table[SYMBOL][0]
func_start, func_size = table[FUNC]
entry = gdb.Breakpoint(f"*{entry_address:#x}", internal=True)
entry.ignore_count = SKIP
gdb.execute("continue", to_string=True)
main_thread = gdb.selected_thread().num
sp0 = reg("rsp")
arch = gdb.selected_frame().architecture()
lines = []
while True:
    pc = reg("rip")
    rel = pc - base - func_start
    if 0 <= rel < func_size:
        text = arch.disassemble(pc)[0]["asm"]
        lines.append(f"{rel:5x}  {text}")
    gdb.execute("stepi", to_string=True)
    if gdb.selected_thread().num == main_thread and reg("rsp") > sp0:
        break
print("TRACE-BEGIN")
print("\n".join(lines))
print("TRACE-END")
gdb.execute("kill", to_string=True)
