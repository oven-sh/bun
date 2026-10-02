# gdb python: counts the instructions one function executes per call (callees stepped over).
# env: ICOUNT_ADDR (hex), ICOUNT_SIZE (dec), ICOUNT_NAME, ICOUNT_MAXCALLS
import gdb, os
addr = int(os.environ["ICOUNT_ADDR"], 16)
size = int(os.environ["ICOUNT_SIZE"])
name = os.environ["ICOUNT_NAME"]
maxcalls = int(os.environ.get("ICOUNT_MAXCALLS", "60"))
gdb.execute("set pagination off")
gdb.execute("set confirm off")
for sig in ("SIGUSR1", "SIGPWR", "SIGXCPU", "SIGPIPE", "SIGSEGV", "SIGUSR2", "SIGCHLD", "SIGALRM"):
    gdb.execute("handle %s nostop noprint pass" % sig)
bp = gdb.Breakpoint("*0x%x" % addr)
gdb.execute("run")
calls = 0
def reg(n):
    return int(gdb.parse_and_eval("$" + n))
while True:
    try:
        pc = reg("pc")
    except gdb.error:
        break
    if pc != addr:
        break
    calls += 1
    if calls > maxcalls:
        bp.enabled = False
        try:
            gdb.execute("continue")
        except gdb.error:
            pass
        break
    sp0 = reg("sp")
    own = 0
    other = 0
    bp.enabled = False
    ok = True
    while True:
        if addr <= pc < addr + size:
            own += 1
        else:
            other += 1
        try:
            gdb.execute("nexti", to_string=True)
            pc = reg("pc")
            sp = reg("sp")
        except gdb.error:
            ok = False
            break
        if sp > sp0:
            break
    print("ICOUNT %s call=%d own=%d other=%d%s" % (name, calls, own, other, "" if ok else " (ended)"))
    if not ok:
        break
    bp.enabled = True
    try:
        gdb.execute("continue")
    except gdb.error:
        break
