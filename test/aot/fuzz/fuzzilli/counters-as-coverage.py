#!/usr/bin/python3
# counters-as-coverage.py <arguments of bun ..>: what Fuzzilli starts in place of Bun, so that it searches instead of only drawing. It needs no instrumented build.
#
# Fuzzilli keeps a program in its corpus, and mutates it further, when the program sets a bit of the coverage map that no earlier program has set.
# This file stands between Fuzzilli and the Bun that collects programs (BUN_FUZZILLI_COLLECTOR). It hands each program on to that Bun, which stores it in a folder.
# Then it compiles the stored program with the Bun under test (BUN_FUZZILLI_COUNTS_WITH): `bun check --aot --aot-report` goes through every stage and writes no executable. The report holds several hundred counters of the compiler:
# how often each pass changed something, how many checks the analysis removed, how many sites were resolved in which way.
# A bit of the map stands for a counter and the size class of how far the program moved it from where an empty program leaves it.
# At the end it moves the program into BUN_FUZZILLI_COLLECTS_PROGRAMS, where run-batch.ts takes it, if the program set a bit that this process has not seen set, and one in eight of the others.
import glob, json, mmap, os, random, re, shutil, struct, subprocess, sys, zlib

processors = sorted(os.sched_getaffinity(0))
EDGES = 1 << 16
SIZE = 16 << 20
environment = dict(os.environ)
collector, counts_with, spool = (environment[name] for name in ("BUN_FUZZILLI_COLLECTOR", "BUN_FUZZILLI_COUNTS_WITH", "BUN_FUZZILLI_COLLECTS_PROGRAMS"))
staged = "%s-staged-%d" % (spool.rstrip("/"), os.getpid())
work = "%s-work-%d" % (spool.rstrip("/"), os.getpid())
# Fuzzilli starts this file anew every few hundred programs. What an earlier process left goes.
for left in glob.glob(spool.rstrip("/") + "-staged-*") + glob.glob(spool.rstrip("/") + "-work-*"):
    if not os.path.exists("/proc/" + left.rsplit("-", 1)[1]): shutil.rmtree(left, ignore_errors=True)
for folder in (staged, work): os.makedirs(folder, exist_ok=True)

shared = os.open("/dev/shm/" + environment.pop("SHM_ID"), os.O_RDWR)
bits = mmap.mmap(shared, 0x200000)
bits[0:4] = struct.pack("<I", EDGES)

# What differs from run to run, or follows the size of the text alone.
unsteady = re.compile("seconds|bytes|peak|memory|resident|threads|sourcelines", re.IGNORECASE)


def counters_of(path):
    report = os.path.join(work, "report.json")
    try: os.remove(report)
    except FileNotFoundError: pass
    try:
        # `bun check` takes a thread for each processor it may run on, and has no flag for fewer: the compile gets one processor, drawn anew each time.
        subprocess.run([counts_with, "check", "--aot", "--aot-report", report, path], preexec_fn=lambda: os.sched_setaffinity(0, {random.choice(processors)}),
                       cwd=os.path.dirname(path), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60,
                       env={"HOME": environment.get("HOME", "/tmp"), "BUN_ENABLE_CRASH_REPORTING": "0", "DO_NOT_TRACK": "1", "NO_COLOR": "1"})
        with open(report) as file: read = json.load(file)
    except (subprocess.TimeoutExpired, OSError, ValueError):
        return None
    found = {name: value for name, value in read["statistics"].items() if isinstance(value, int) and not unsteady.search(name)}
    for each in read.get("passes") or []:
        if isinstance(each, dict):
            for key, value in each.items():
                if isinstance(value, int) and not unsteady.search(key): found["%s.%s" % (each.get("name"), key)] = value
    return found


def start_collector():
    control_read, to_child = os.pipe(); from_child, control_write = os.pipe()
    data = os.memfd_create("data"); os.ftruncate(data, SIZE); out = os.memfd_create("out"); os.ftruncate(out, SIZE)
    child = os.fork()
    if child == 0:
        for source, target in ((control_read, 100), (control_write, 101), (data, 102), (out, 103)): os.dup2(source, target, inheritable=True)
        os.execve(collector, [collector] + sys.argv[1:], dict(environment, BUN_FUZZILLI_COLLECTS_PROGRAMS=staged))
    os.close(control_read); os.close(control_write)
    assert os.read(from_child, 4) == b"HELO"; os.write(to_child, b"HELO")
    return child, from_child, to_child, mmap.mmap(data, SIZE)


# The descriptors that Fuzzilli gave this process move out of the way of the collector's.
from_fuzzilli, to_fuzzilli, script = os.dup(100), os.dup(101), mmap.mmap(102, SIZE)
for descriptor in (100, 101, 102, 103): os.close(descriptor)

extension = os.path.splitext(sys.argv[-1])[1]
empty = os.path.join(work, "empty" + extension)
with open(empty, "w") as file: file.write("const printValue = console.log;\nexport {};\n")
baseline = counters_of(empty) or {}

os.write(to_fuzzilli, b"HELO"); assert os.read(from_fuzzilli, 4) == b"HELO"
collecting = None
seen = set()
programs = 0
while True:
    request = os.read(from_fuzzilli, 4)
    if request != b"exec": break
    length = struct.unpack("<Q", os.read(from_fuzzilli, 8))[0]
    if collecting is None: collecting = start_collector()
    child, from_child, to_child, data = collecting
    data[:length] = script[:length]
    os.write(to_child, b"exec" + struct.pack("<Q", length))
    reply = os.read(from_child, 4)
    if len(reply) != 4:
        _, status = os.waitpid(child, 0)
        reply = struct.pack("<I", os.WTERMSIG(status) if os.WIFSIGNALED(status) else os.WEXITSTATUS(status) << 8)
        collecting = None
    for name in os.listdir(staged):
        path = os.path.join(staged, name)
        found = counters_of(path)
        is_new = False
        programs += 1
        # A build that writes no report was refused or stopped. That is one bit of its own.
        for counter, value in (found if found is not None else {"no report": 1}).items():
            moved = value - baseline.get(counter, 0)
            if moved == 0: continue
            edge = 1 + zlib.crc32(("%s %s%d" % (counter, "-" if moved < 0 else "+", abs(moved).bit_length())).encode()) % (EDGES - 1)
            bits[4 + (edge >> 3)] |= 1 << (edge & 7)
            if edge not in seen: seen.add(edge); is_new = True
        if is_new or programs % 8 == 0: shutil.move(path, os.path.join(spool, name))
        else: os.remove(path)
    os.write(to_fuzzilli, reply)
