# Counts the instructions executed from the entry of the function at $STEP_ADDR until it returns.
import gdb, os
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set startup-with-shell off")
for sig in ("SIGPWR", "SIGXCPU", "SIGSEGV", "SIGUSR1", "SIGPIPE"):
    gdb.execute("handle %s nostop noprint pass" % sig)
addr = os.environ["STEP_ADDR"]
gdb.execute("break *" + addr)
gdb.execute("run")
frame_sp = int(gdb.parse_and_eval("$rsp"))
ret = int(gdb.parse_and_eval("*(unsigned long*)$rsp"))
gdb.execute("delete")
gdb.execute("set scheduler-locking on")
count = 0
while True:
    gdb.execute("stepi", to_string=True)
    count += 1
    pc = int(gdb.parse_and_eval("$pc"))
    if pc == ret and int(gdb.parse_and_eval("$rsp")) > frame_sp:
        break
    if count > 5000000:
        print("STEPS overflow")
        break
print("STEPS %d" % count)
gdb.execute("set scheduler-locking off")
gdb.execute("kill")
