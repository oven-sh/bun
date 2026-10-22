#!/usr/bin/env python3
"""border_matrix.py <bun> <generator.py> <first seed> <last seed> [-j n] [--words w] [--out folder]: how the rows of untyped-border.py fare, by how the value is made and by how it gets in.

Every program is built with `bun build --compile --aot` and run, and run by plain `bun run`. A row is judged by its first line that departs:
  same      every line of the row is as plain Bun prints it
  REFUSED   the compiled program throws a TypeError of --aot there and plain Bun does not, in typed code or in a change that untyped code makes
  DIFFERENT any other departure: a silent one
  DIED      the executable ended by a signal or the build failed
Prints three tables (by maker, by way in, by what typed code did at the first departing line) and every DIFFERENT and DIED row with its seed."""
import collections, concurrent.futures, os, re, shutil, subprocess, sys, tempfile

arguments = sys.argv[1:]


def option(name, default):
    if name in arguments:
        i = arguments.index(name)
        value = arguments[i + 1]
        del arguments[i:i + 2]
        return value
    return default


jobs, words, out = int(option("-j", "4")), option("--words", ""), option("--out", "")
bun, generator, first, last = arguments[0], arguments[1], int(arguments[2]), int(arguments[3])
ENV = {"PATH": "/usr/bin:/bin", "NO_COLOR": "1", "BUN_ENABLE_CRASH_REPORTING": "0", "DO_NOT_TRACK": "1", "HOME": os.environ.get("HOME", "/tmp"), "WTF_numberOfProcessorCores": "2", "UV_THREADPOOL_SIZE": "2", "GOMAXPROCS": "2"}
LABEL = re.compile(r"^(r\d+) \[([^\]]*)\] \[([^\]]*)\] ([^:]*): (.*)$")


def run(command, cwd, seconds):
    try:
        done = subprocess.run(command, cwd=cwd, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=seconds)
        return done.returncode, done.stdout.decode(errors="replace"), done.stderr.decode(errors="replace")
    except subprocess.TimeoutExpired:
        return None, "", ""


def one(seed):
    folder = tempfile.mkdtemp(prefix="border-%d-" % seed, dir=out or None)
    try:
        text = subprocess.run([sys.executable, generator, str(seed)] + words.split(), stdout=subprocess.PIPE).stdout.decode()
        main, *others = text.split("\n//// ")
        open(os.path.join(folder, "main.ts"), "w").write(main + "\n")
        for other in others:
            path = os.path.join(folder, other[:other.index("\n")])
            os.makedirs(os.path.dirname(path), exist_ok=True)
            open(path, "w").write(other[other.index("\n") + 1:] + "\n")
        where = re.search(r'from "([^"]+)";', main).group(1)
        code, _, errors = run([bun, "build", "--compile", "--aot", "main.ts", "--outfile", "./compiled"], folder, 300)
        if not os.path.exists(os.path.join(folder, "compiled")):
            return seed, where, [("-", "-", "-", "the build", "DIED", (re.findall(r"^(?:error|panic).*", errors, re.M) or ["exit %s" % code])[0][:160])]
        code, ours, ours_errors = run(["./compiled"], folder, 120)
        os.remove(os.path.join(folder, "compiled"))
        plain_code, plain, _ = run([bun, "run", "main.ts"], folder, 120)
        rows, verdicts = collections.OrderedDict(), []
        ours_lines = {m.group(1) + m.group(4): m.group(5) for m in map(LABEL.match, ours.split("\n")) if m}
        for m in filter(None, map(LABEL.match, plain.split("\n"))):
            rows.setdefault(m.group(1), []).append(m)
        for row, lines in rows.items():
            verdict = (row, lines[0].group(2), lines[0].group(3), "", "same", "")
            for m in lines:
                got = ours_lines.get(row + m.group(4))
                if got == m.group(5): continue
                label = "%s [%s] [%s] %s" % (row, m.group(2), m.group(3), m.group(4))
                said = [line for line in ours_errors.split("\n") if line.startswith(label + " ")]
                if got is None: kind, detail = "DIED", "exit %s" % code
                elif got.startswith("THROWS TypeError") and said and "(bun compile" in said[0]: kind, detail = "REFUSED", said[0][len(label) + 1:].split(" (bun compile")[0]
                elif re.search(r"(poke|spoil) THROWS TypeError", got) and not re.search(r"(poke|spoil) THROWS TypeError", m.group(5)):
                    kind = "REFUSED"
                    detail = next((line[len(m.group(1)) + 16:] for line in ours_errors.split("\n") if line.startswith(m.group(1) + " refused change ")), "a change by untyped code threw")
                else: kind, detail = "DIFFERENT", "compiled '%s' | plain '%s'" % (got[:110], m.group(5)[:110])
                verdict = (row, m.group(2), m.group(3), m.group(4), kind, detail)
                break
            verdicts.append(verdict)
        return seed, where, verdicts
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def table(title, counts):
    print("\n| %s | rows | same | REFUSED | DIFFERENT | DIED |\n|---|---:|---:|---:|---:|---:|" % title)
    for key, c in sorted(counts.items(), key=lambda item: (-(item[1]["REFUSED"] + item[1]["DIFFERENT"] + item[1]["DIED"]) / max(1, sum(item[1].values())), item[0])):
        print("| %s | %d | %d | %d | %d | %d |" % (key, sum(c.values()), c["same"], c["REFUSED"], c["DIFFERENT"], c["DIED"]))


by_maker, by_door, by_use, by_where, by_message = (collections.defaultdict(collections.Counter) for _ in range(5))
loud, departing = [], []
with concurrent.futures.ThreadPoolExecutor(jobs) as pool:
    for seed, where, verdicts in pool.map(one, range(first, last + 1)):
        if any(verdict[4] != "same" for verdict in verdicts): departing.append(seed)
        for row, maker, door, use, kind, detail in verdicts:
            by_maker[maker][kind] += 1
            by_door[door][kind] += 1
            by_where[where][kind] += 1
            if kind != "same": by_use[use][kind] += 1
            if kind == "REFUSED": by_message[re.sub(r"\d+", "N", detail)[:110]][kind] += 1
            if kind in ("DIFFERENT", "DIED"): loud.append("seed %d %s [%s] [%s] %s: %s: %s" % (seed, row, maker, door, use, kind, detail))
total = collections.Counter()
for c in by_maker.values(): total.update(c)
print("%s | seeds %d..%d %s | rows %d: same %d, REFUSED %d, DIFFERENT %d, DIED %d" % (os.path.basename(bun), first, last, words, sum(total.values()), total["same"], total["REFUSED"], total["DIFFERENT"], total["DIED"]))
table("where the untyped code is", by_where)
table("how the value is made", by_maker)
table("how it gets in", by_door)
table("what typed code did at the first departing line", by_use)
table("what the refusal says", by_message)
print("\nDIFFERENT and DIED, every row:")
print("\n".join(loud) or "none")
print("\nSeeds with a departing row: " + " ".join(map(str, departing)))
