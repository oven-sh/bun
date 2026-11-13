# gdb --readnever -batch -x count.py --args <bun> build ./src/index.ts --dts --outdir out
# Counts calls of the Rust allocator entry points while a thread is inside module_types or add_types,
# and calls of stated_type and check_request. Symbols come from $SYMBOLS (nm of the binary).
import gdb, re, os

wanted = {
    "module_types": re.compile(r"15bun_sema_driver11typed_files12module_types$"),
    "add_types": re.compile(r"15bun_sema_driver11typed_files9add_types$"),
    "stated_type": re.compile(r"11stated_type$"),
    "check_request": re.compile(r"15bun_sema_driver13check_request$"),
    "alloc": re.compile(r"___rust_(alloc|alloc_zeroed|realloc)$"),
}
found = {key: [] for key in wanted}
for line in open(os.environ.get("SYMBOLS", "/tmp/measure/symbols.txt")):
    parts = line.split()
    if len(parts) != 3 or parts[1] not in "tT":
        continue
    for key, pattern in wanted.items():
        if pattern.search(parts[2]):
            found[key].append(int(parts[0], 16))

counts = {"allocs in module_types": 0, "allocs in add_types": 0, "module_types": 0, "add_types": 0,
          "stated_type": 0, "check_request": 0}
inside = {}

def thread():
    return gdb.selected_thread().num

class Alloc(gdb.Breakpoint):
    def stop(self):
        for key in inside.get(thread(), ()):
            counts["allocs in " + key] += 1
        return False

allocs = [Alloc("*%d" % address, internal=True) for address in found["alloc"]]
for alloc in allocs:
    alloc.enabled = False

def set_allocs():
    on = any(inside.values())
    for alloc in allocs:
        alloc.enabled = on

class Leave(gdb.FinishBreakpoint):
    def __init__(self, key):
        super().__init__(gdb.newest_frame(), internal=True)
        self.key, self.thread_number = key, thread()
    def left(self):
        inside[self.thread_number].remove(self.key)
        set_allocs()
    def stop(self):
        self.left()
        return False
    def out_of_scope(self):
        self.left()

class Enter(gdb.Breakpoint):
    def __init__(self, address, key):
        super().__init__("*%d" % address, internal=True)
        self.key = key
    def stop(self):
        counts[self.key] += 1
        inside.setdefault(thread(), []).append(self.key)
        set_allocs()
        Leave(self.key)
        return False

class Count(gdb.Breakpoint):
    def __init__(self, address, key):
        super().__init__("*%d" % address, internal=True)
        self.key = key
    def stop(self):
        counts[self.key] += 1
        return False

for key in ("module_types", "add_types"):
    for address in found[key]:
        Enter(address, key)
for key in ("stated_type", "check_request"):
    for address in found[key]:
        Count(address, key)

gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("handle SIGPWR SIGXCPU SIGUSR1 SIGUSR2 nostop noprint pass")
gdb.execute("run")
with open(os.environ.get("COUNTS_OUT", "/tmp/measure/counts.out"), "w") as out:
    out.write("symbols: %s\n" % {key: len(addresses) for key, addresses in found.items()})
    out.write("counts: %s\n" % counts)
