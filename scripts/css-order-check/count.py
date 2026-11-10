# Counts allocator calls inside the CSS order pass.
#   ACCT_BIN=<bun-debug> ACCT_CWD=<dir> ACCT_ARGS="build entry.css --minify-whitespace" gdb -q -batch -x scripts/css-order-check/count.py
import gdb, os, subprocess
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set debuginfod enabled off")
for s in ["SIGPWR", "SIGXCPU", "SIGUSR1", "SIGUSR2", "SIGSEGV", "SIGPIPE"]:
    gdb.execute("handle %s nostop noprint pass" % s)
binary = os.environ["ACCT_BIN"]
gdb.execute("exec-file " + binary)
gdb.execute("set args " + os.environ["ACCT_ARGS"])
gdb.execute("set cwd " + os.environ["ACCT_CWD"])
gdb.execute("set environment BUN_DEBUG_QUIET_LOGS 1")
gdb.execute("set environment NO_COLOR 1")

syms = {}
out = subprocess.run(["nm", "-C", "--defined-only", binary], capture_output=True, text=True).stdout
wanted = {
    "order_pass": lambda n: n.endswith("find_imported_files_in_css_order::find_imported_files_in_css_order"),
    "rust_alloc": lambda n: n in ("__rust_alloc", "__rustc::__rust_alloc"),
    "rust_alloc_zeroed": lambda n: n in ("__rust_alloc_zeroed", "__rustc::__rust_alloc_zeroed"),
    "rust_realloc": lambda n: n in ("__rust_realloc", "__rustc::__rust_realloc"),
    "mi_heap_malloc": lambda n: n == "mi_heap_malloc",
    "mi_heap_malloc_aligned": lambda n: n == "mi_heap_malloc_aligned",
    "mi_heap_zalloc": lambda n: n == "mi_heap_zalloc",
    "mi_heap_zalloc_aligned": lambda n: n == "mi_heap_zalloc_aligned",
    "mi_heap_realloc": lambda n: n == "mi_heap_realloc",
    "mi_heap_realloc_aligned": lambda n: n == "mi_heap_realloc_aligned",
}
for line in out.splitlines():
    parts = line.split(" ", 2)
    if len(parts) < 3 or parts[1] not in "tTwW":
        continue
    for key, match in wanted.items():
        if key not in syms and match(parts[2]):
            syms[key] = int(parts[0], 16)
if "order_pass" not in syms:
    print("RESULT no order pass symbol")
    gdb.execute("quit")

class Count(gdb.Breakpoint):
    def __init__(self, addr, name):
        super().__init__("*%#x" % addr)
        self.cname = name
        self.n = 0
        self.enabled = False
    def stop(self):
        self.n += 1
        return False

counters = [Count(a, n) for n, a in syms.items() if n != "order_pass"]
gdb.Breakpoint("*%#x" % syms["order_pass"])
gdb.execute("run")
calls = 0
totals = {}
while True:
    try:
        pc = int(gdb.parse_and_eval("(unsigned long)$pc"))
    except gdb.error:
        break
    if pc != syms["order_pass"]:
        try:
            gdb.execute("continue")
        except gdb.error:
            break
        continue
    calls += 1
    ret = int(gdb.parse_and_eval("*(unsigned long*)$rsp"))
    gdb.execute("set scheduler-locking on")
    for c in counters:
        c.n = 0
        c.enabled = True
    gdb.Breakpoint("*%#x" % ret, temporary=True)
    gdb.execute("continue")
    for c in counters:
        c.enabled = False
        totals[c.cname] = totals.get(c.cname, 0) + c.n
    gdb.execute("set scheduler-locking off")
    try:
        gdb.execute("continue")
    except gdb.error:
        break
print("RESULT calls=%d allocations=%d %s" % (calls, sum(totals.values()), " ".join("%s=%d" % kv for kv in sorted(totals.items()) if kv[1])))
