#!/usr/bin/env python3
"""Every row of ./idioms and ./operations, compiled ahead of time against the same source under the JIT.

    python3 test/aot/perf/against_the_jit.py <bun whose `build --compile` takes --aot> <bun to run the JIT's column with> [--cores 0-15] [--only array/] [--out rows.tsv]

The method is that of idioms.test.ts and operations.test.ts. The cost of one iteration of an idiom is the difference between a run of n iterations
and a run of n / 4, divided by 3n / 4; the cost of one site of an operation is the difference between a function with 12 sites and one with 4, each as
the difference of a run with many calls and a run with few. Start-up, warm-up and compiling cancel out. Here both runs of an operation lie behind the JIT's last tier.
Collections run on the program's own thread, and the JIT compiles on it too, so that nothing is a matter of chance. Every form must print the same.

Counted around the whole process, each run pinned to a core of its own: user-mode instructions (the same at any load) and CPU time (idle cores only).
It prints ahead | level (within 2%) | behind by both, then the rows that lose, worst first. A cost under half an instruction counts as half: the JIT folds
some loops away whole, and a ratio to nothing says nothing. CPU time is judged only where both sides take at least half a nanosecond.

It needs Linux, `perf` and `taskset`. About two minutes on sixteen cores.
"""
import argparse, json, os, queue, shutil, subprocess, sys, tempfile, threading

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("aot")
parser.add_argument("jit")
parser.add_argument("--cores", default="0-15")
parser.add_argument("--only", default="", help="only the rows whose path (idioms/.. or operations/..) contains this text")
parser.add_argument("--out", help="also writes set, name, form, instructions, ns, the JIT's instructions, the JIT's ns")
parser.add_argument("--rows", type=int, default=30, help="how many losing rows to list")
options = parser.parse_args()

HERE = os.path.dirname(os.path.abspath(__file__))
aot, jit = os.path.abspath(options.aot), os.path.abspath(options.jit)
first, _, last = options.cores.partition("-")
cores = list(range(int(first), int(last or first) + 1))
work = tempfile.mkdtemp(prefix="against-the-jit-")
OPERATIONS = os.path.join(work, "operations")
subprocess.run([sys.executable, os.path.join(HERE, "operations", "generate.py"), OPERATIONS], check=True, stdout=subprocess.DEVNULL)
json.dump({"extends": os.path.join(HERE, "operations", "tsconfig.json")}, open(os.path.join(OPERATIONS, "tsconfig.json"), "w"))
IDIOMS = os.path.join(work, "idioms")
subprocess.run([jit, os.path.join(HERE, "untyped-idioms.ts"), IDIOMS], check=True)
STEADY = {"BUN_GC_TIMER_DISABLE": "1", "BUN_JSC_percentCPUPerMBForEdenTimer": "0", "BUN_JSC_percentCPUPerMBForFullTimer": "0", "BUN_JSC_useConcurrentGC": "0", "BUN_JSC_numberOfGCMarkers": "1", "BUN_JSC_useConcurrentJIT": "0"}
BASE = dict(os.environ, NO_COLOR="1", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1", BUN_DEBUG_QUIET_LOGS="1", **STEADY)


def measure(core, command, cwd, env={}):
    report = os.path.join(work, "stat-%d" % core)
    run = subprocess.run(["taskset", "-c", str(core), "perf", "stat", "-x,", "-o", report, "-e", "instructions:u,task-clock", "--"] + command, cwd=cwd, env=dict(BASE, **env), capture_output=True, text=True, timeout=600)
    counted = {}
    for line in open(report):
        fields = line.split(",")
        if len(fields) > 2 and fields[0].replace(".", "").isdigit():
            counted[fields[2].split(":")[0]] = float(fields[0])
    if run.returncode or "instructions" not in counted:
        raise RuntimeError("%s: exit %s: %s" % (" ".join(command[-3:]), run.returncode, run.stderr[-200:]))
    return counted["instructions"], counted["task-clock"] * 1e6, run.stdout


def build(core, source, cwd, name):
    executable = os.path.join(work, name)
    run = subprocess.run(["taskset", "-c", str(core), aot, "build", "--compile", "--aot", source, "--outfile", executable], cwd=cwd, env=BASE, capture_output=True, text=True, timeout=900)
    if run.returncode or not os.path.exists(executable):
        raise RuntimeError("build of %s: exit %s: %s" % (source, run.returncode, run.stderr[-200:]))
    return executable


def idiom(core, name, turns):
    root = IDIOMS

    def one_turn(command):
        short, long = (measure(core, command, root, {"AOT_PERF_TURNS": str(n)}) for n in (turns >> 2, turns))
        return (long[0] - short[0]) / (turns - (turns >> 2)), (long[1] - short[1]) / (turns - (turns >> 2)), long[2]

    under_jit, rows = one_turn([jit, "run", os.path.join(root, name + ".js")]), []
    for form, extension in (("typed", ".ts"), ("untyped", ".js")):
        folder = os.path.join(HERE, "idioms") if form == "typed" else root
        executable = build(core, os.path.join(folder, name + extension), folder, "idiom-%s-%s" % (name.replace("/", "-"), form))
        try:
            compiled = one_turn([executable])
        finally:
            os.remove(executable)
        rows.append(("idioms", name, form if compiled[2] == under_jit[2] else form + " PRINTS OTHERWISE", compiled[0], compiled[1], under_jit[0], under_jit[1]))
    return rows


def operation(core, name, is_heavy):
    root = OPERATIONS
    source = os.path.join(root, "alone", name + ".ts")
    few, many = (21000, 84000) if is_heavy else (400000, 1600000)

    def one_site(command):
        runs = {(sites, calls): measure(core, command + ["%s_%d" % (name, sites), str(calls), "2", "lit_zz", "DELETE", "PATCH"], root) for sites in (4, 12) for calls in (few, many)}
        return tuple(((runs[12, many][i] - runs[12, few][i]) - (runs[4, many][i] - runs[4, few][i])) / 8 / (many - few) for i in (0, 1)) + (runs[12, few][2],)

    under_jit = one_site([jit, "run", source])
    executable = build(core, source, root, "operation-" + name)
    try:
        compiled = one_site([executable])
    finally:
        os.remove(executable)
    return [("operations", name, "typed" if compiled[2] == under_jit[2] else "typed PRINTS OTHERWISE", compiled[0], compiled[1], under_jit[0], under_jit[1])]


jobs = queue.Queue()
turns = json.load(open(os.path.join(HERE, "turns.json")))
for folder, _, files in sorted(os.walk(os.path.join(HERE, "idioms"))):
    for file in sorted(files):
        name = os.path.relpath(os.path.join(folder, file), os.path.join(HERE, "idioms"))[:-3]
        if file.endswith(".ts") and name in turns and options.only in "idioms/" + name:
            jobs.put((idiom, name, turns[name]))
for line in open(os.path.join(OPERATIONS, "rows.tsv")):
    fields = line.rstrip("\n").split("\t")
    if len(fields) > 4 and fields[4] == "1" and options.only in "operations/" + fields[0]:
        jobs.put((operation, fields[0], fields[3] == "1"))

rows, lock = [], threading.Lock()


def worker(core):
    while True:
        try:
            job, name, argument = jobs.get_nowait()
        except queue.Empty:
            return
        try:
            measured = job(core, name, argument)
        except Exception as error:
            measured = [(job.__name__ + "s", name, "FAILED: " + str(error).replace("\n", " ")[:200], 0, 0, 0, 0)]
        with lock:
            rows.extend(measured)


threads = [threading.Thread(target=worker, args=(core,)) for core in cores]
for thread in threads:
    thread.start()
for thread in threads:
    thread.join()
shutil.rmtree(work, ignore_errors=True)
rows.sort()
if options.out:
    with open(options.out, "w") as out:
        for row in rows:
            out.write("%s\t%s\t%s\t%.2f\t%.3f\t%.2f\t%.3f\n" % row)


def tally(ratios):
    return sum(1 for each in ratios if each < 0.98), sum(1 for each in ratios if 0.98 <= each <= 1.02), sum(1 for each in ratios if each > 1.02), len(ratios)


for group, form in (("idioms", "typed"), ("idioms", "untyped"), ("operations", "typed")):
    measured = [row for row in rows if row[0] == group and row[2] == form]
    if not measured:
        continue
    by_instructions = sorted(((max(row[3], 0.5) / max(row[5], 0.5), row) for row in measured), reverse=True)
    by_time = sorted(((row[4] / row[6], row) for row in measured if row[4] >= 0.5 and row[6] >= 0.5), reverse=True)
    print("%s, %s, compiled | the JIT. By instructions: ahead %d | level %d | behind %d of %d. By CPU time: ahead %d | level %d | behind %d of the %d that a clock resolves." % ((group, form) + tally([each[0] for each in by_instructions]) + tally([each[0] for each in by_time])))
    print("  behind by instructions, worst first: " + "; ".join("%s x%.1f (%.0f | %.0f)" % (row[1], ratio, row[3], row[5]) for ratio, row in by_instructions[: options.rows] if ratio > 1.02))
    print("  behind by CPU ns, worst first: " + "; ".join("%s x%.1f (%.1f | %.1f)" % (row[1], ratio, row[4], row[6]) for ratio, row in by_time[: options.rows] if ratio > 1.02))
    print("  ahead by instructions, best first: " + "; ".join("%s x%.2f (%.0f | %.0f)" % (row[1], ratio, row[3], row[5]) for ratio, row in by_instructions[::-1][:10] if ratio < 0.98))
failed = [row for row in rows if row[2].startswith("FAILED") or "OTHERWISE" in row[2]]
if failed:
    print("Not measured, %d: %s" % (len(failed), "; ".join("%s/%s %s" % (row[0], row[1], row[2][:90]) for row in failed[:12])))
