# gdb script: counts the instructions that one call of a function executes, from its first
# instruction to its return, by single-stepping. One line per call of the function.
# With INNER set, it also counts the part that runs inside that callee, so that
# "own" = total - inner is the function's own work.
#
#   FN=us_nq_stream_send_headers INNER=lsquic_stream_send_headers OUT=/tmp/count.txt \
#     gdb -batch -x count-instructions.py --args <bun-profile> count-program.mjs 4 >/dev/null 2>&1
#
# With RANGES="name=0xSTART:0xSIZE,..." (from `nm -S`), it also counts the instructions whose
# address is inside each of those functions. FN can be an address (0x...), for Rust symbols.
#
# Only the stepped thread runs while a call is counted (scheduler-locking), so the count does not
# depend on what the other threads do.
import os

import gdb

fn = os.environ.get("FN", "us_nq_stream_send_headers")
inner = os.environ.get("INNER", "")
limit = int(os.environ.get("LIMIT", "300000"))
out = os.environ.get("OUT", "/tmp/count.txt")
gdb.execute("set pagination off")
gdb.execute("set confirm off")
gdb.execute("set print thread-events off")
# The casts below are C. gdb picks Rust for this binary.
gdb.execute("set language c")
for sig in ("SIGPWR", "SIGXCPU", "SIGUSR1", "SIGUSR2", "SIGPIPE", "SIGCHLD", "SIGALRM", "SIGSEGV", "SIGBUS"):
    gdb.execute(f"handle {sig} nostop noprint pass", to_string=True)
# `*fn` is the function's first instruction. There, before the prologue, [$sp] is the return address.
gdb.Breakpoint("*" + fn)
inner_entry = int(gdb.parse_and_eval("(unsigned long)&" + inner)) if inner else None
ranges = []
for item in filter(None, os.environ.get("RANGES", "").split(",")):
    name, _, span = item.partition("=")
    start, _, size = span.partition(":")
    ranges.append((name, int(start, 16), int(start, 16) + int(size, 16)))


def reg(name):
    return int(gdb.parse_and_eval("(unsigned long)$" + name))


def return_address():
    return int(gdb.parse_and_eval("*(unsigned long *)$sp"))


gdb.execute("run", to_string=True)
if gdb.selected_inferior().pid != 0:
    gdb.execute("set scheduler-locking step")
call = 0
while gdb.selected_inferior().pid != 0:
    sp, ret = reg("sp"), return_address()
    call += 1
    total = 0
    inside = 0
    inner_frame = None
    in_range = [0] * len(ranges)
    while total < limit:
        pc = reg("pc")
        if inner_frame is None and pc == inner_entry:
            inner_frame = (reg("sp"), return_address())
        for i, (_, start, end) in enumerate(ranges):
            if start <= pc < end:
                in_range[i] += 1
        gdb.execute("stepi", to_string=True)
        total += 1
        if inner_frame is not None:
            inside += 1
            if reg("pc") == inner_frame[1] and reg("sp") > inner_frame[0]:
                inner_frame = None
        if reg("pc") == ret and reg("sp") > sp:
            break
    with open(out, "a") as f:
        spans = "".join(f" {name} {n}" for (name, _, _), n in zip(ranges, in_range))
        f.write(f"{fn} call {call}: total {total} inner {inside} own {total - inside}{spans}\n")
    try:
        gdb.execute("continue", to_string=True)
    except gdb.error:
        break
