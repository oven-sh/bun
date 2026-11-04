#!/usr/bin/python3
# counters-as-coverage.py <arguments of bun ..>: what Fuzzilli starts in place of Bun, so that it searches instead of only drawing. It needs no instrumented build.
#
# Fuzzilli keeps a program in its corpus, and mutates it further, when the program sets a bit of the coverage map that no earlier program has set.
# This file stands between Fuzzilli and the Bun that collects programs (BUN_FUZZILLI_COLLECTOR). It hands each program on to that Bun, which stores it in a folder.
# Then it builds the stored program with the Bun under test (BUN_FUZZILLI_COUNTS_WITH), which writes no executable. With --explain=statistics and --explain=forms the build prints several hundred counters of the compiler:
# how often each stage touched what it works on, how many calls were inlined, how many tests leave or rejoin, and at how many sites each operation was emitted in which form.
# A bit of the map stands for a counter and the size class of how far the program moved it from where an empty program leaves it.
# At the end it moves the program into BUN_FUZZILLI_COLLECTS_PROGRAMS, where run-batch.ts takes it, if the program set a bit that this process has not seen set, and one in eight of the others.
import glob, mmap, os, re, shutil, struct, subprocess, sys, zlib

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
# "ValuesWalked 1204"
statistic = re.compile(r"^([A-Z][A-Za-z0-9]*) (\d+)$", re.MULTILINE)
# "aot: forms: GetSlot open: 1,204 sites, 72,240 bytes, 60 a site" | "aot: forms: Mod NumbersAndWholeDivisor open: .."
form = re.compile(r"^aot: forms: (\w+(?: \w+)+): ([\d,]+) sites?, ", re.MULTILINE)


def counters_of(path):
    try:
        built = subprocess.run([counts_with, "build", "--compile", "--aot", "--aot-threads=1", "--aot-testing=NoExecutable", "--explain=statistics", "--explain=forms", path, "--outfile", os.path.join(work, "program")],
                               cwd=os.path.dirname(path), stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, encoding="latin-1", timeout=60,
                               env={"HOME": environment.get("HOME", "/tmp"), "BUN_ENABLE_CRASH_REPORTING": "0", "DO_NOT_TRACK": "1", "NO_COLOR": "1"})
    except (subprocess.TimeoutExpired, OSError):
        return None
    statistics, forms = statistic.findall(built.stderr), form.findall(built.stderr)
    if built.returncode != 0 or not statistics or not forms: return None
    found = {name: int(value) for name, value in statistics if not unsteady.search(name)}
    for name, sites in forms: found[name] = int(sites.replace(",", ""))
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
# Without a baseline every program would set the one bit for a build without counters, and Fuzzilli would be drawing again with nothing to show it.
baseline = counters_of(empty)
assert baseline, "the build of an empty program printed no counters under --explain=statistics or --explain=forms"

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
        # A build that prints no counters was refused or stopped. That is one bit of its own.
        for counter, value in (found if found is not None else {"no report": 1}).items():
            moved = value - baseline.get(counter, 0)
            if moved == 0: continue
            edge = 1 + zlib.crc32(("%s %s%d" % (counter, "-" if moved < 0 else "+", abs(moved).bit_length())).encode()) % (EDGES - 1)
            bits[4 + (edge >> 3)] |= 1 << (edge & 7)
            if edge not in seen: seen.add(edge); is_new = True
        if is_new or programs % 8 == 0: shutil.move(path, os.path.join(spool, name))
        else: os.remove(path)
    os.write(to_fuzzilli, reply)
