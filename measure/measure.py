# gdb script. Counts, on the thread that runs the test, either the instructions or the calls to some functions
# between the entry of one function and its return.
#
#   MEASURE_MODE=insns|calls MEASURE_SYMBOL=<linkage name prefix> MEASURE_SKIP=<hits to skip> MEASURE_RUNS=<hits to measure> \
#     gdb -q -batch -x measure.py --args <bun> test <file>
import os
import subprocess

import gdb

MODE = os.environ["MEASURE_MODE"]
SYMBOL = os.environ["MEASURE_SYMBOL"]
SKIP = int(os.environ.get("MEASURE_SKIP", "100"))
RUNS = int(os.environ.get("MEASURE_RUNS", "3"))
COUNTED = os.environ.get(
    "MEASURE_COUNTED",
    "mi_malloc mi_zalloc mi_calloc mi_realloc mi_malloc_aligned mi_zalloc_aligned mi_new mi_heap_malloc",
).split()

gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set print thread-events off")
gdb.execute("set breakpoint pending off")
gdb.execute("set language c")
for signal in ("SIGUSR1", "SIGUSR2", "SIGPWR", "SIGXCPU", "SIGSEGV", "SIGBUS", "SIGPIPE", "SIGCHLD"):
    gdb.execute(f"handle {signal} nostop noprint pass", to_string=True)

exe = gdb.objfiles()[0].filename


def link_addresses():
    out = subprocess.run(["llvm-nm", "--defined-only", exe], capture_output=True, text=True, check=True).stdout
    table = {}
    for line in out.splitlines():
        parts = line.split(" ", 2)
        if len(parts) == 3:
            table.setdefault(parts[2], int(parts[0], 16))
    return table


symbols = link_addresses()


def resolve(prefix):
    if prefix in symbols:
        return prefix
    matches = sorted(name for name in symbols if name.startswith(prefix))
    assert len(matches) == 1, (prefix, matches[:5])
    return matches[0]


is_pie = b"DYN" in subprocess.run(["llvm-readelf", "-h", exe], capture_output=True, check=True).stdout

gdb.execute("starti", to_string=True)
base = 0
if is_pie:
    for line in gdb.execute("info proc mappings", to_string=True).splitlines():
        fields = line.split()
        if len(fields) >= 5 and fields[-1] == exe:
            base = int(fields[0], 16)
            break


def address(name):
    return base + symbols[resolve(name)]


def reg(name):
    return int(gdb.selected_frame().read_register(name)) & 0xFFFFFFFFFFFFFFFF


def read_word(at):
    return int.from_bytes(bytes(gdb.selected_inferior().read_memory(at, 8)), "little")


entry_address = address(SYMBOL)
entry = gdb.Breakpoint(f"*{entry_address:#x}", internal=True)
entry.ignore_count = SKIP
gdb.execute("continue", to_string=True)
main_thread = gdb.selected_thread().num
results = []

if MODE == "insns":
    for _ in range(RUNS):
        assert reg("rip") == entry_address, hex(reg("rip"))
        sp0 = reg("rsp")
        count = 0
        while True:
            gdb.execute("stepi", to_string=True)
            count += 1
            if gdb.selected_thread().num == main_thread and reg("rsp") > sp0:
                break
        results.append(count)
        gdb.execute("continue", to_string=True)
elif MODE == "calls":
    present = [name for name in COUNTED if name in symbols or any(s.startswith(name) for s in symbols)]
    counted_pcs = {address(name) for name in present}
    counted = [gdb.Breakpoint(f"*{pc:#x}", internal=True) for pc in counted_pcs]
    for bp in counted:
        bp.enabled = False
    total = 0
    for _ in range(RUNS):
        assert reg("rip") == entry_address, hex(reg("rip"))
        return_address = read_word(reg("rsp"))
        sp0 = reg("rsp")
        done = gdb.Breakpoint(f"*{return_address:#x}", internal=True)
        for bp in counted:
            bp.enabled = True
        entry.enabled = False
        while True:
            gdb.execute("continue", to_string=True)
            if gdb.selected_thread().num != main_thread:
                continue
            pc = reg("rip")
            if pc in counted_pcs:
                total += 1
            elif pc == return_address and reg("rsp") > sp0:
                break
        done.delete()
        for bp in counted:
            bp.enabled = False
        entry.enabled = True
        gdb.execute("continue", to_string=True)
    results = [total, RUNS, len(present)]
else:
    raise SystemExit(f"unknown MEASURE_MODE {MODE}")

print(f"RESULT mode={MODE} symbol={SYMBOL[:40]} skip={SKIP} runs={RUNS} -> {results}")
gdb.execute("kill", to_string=True)
