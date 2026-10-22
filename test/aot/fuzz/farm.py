#!/usr/bin/env python3
"""Runs seeded program generators and mutators, round after round, against several builds of Bun, and keeps what differs.

    python3 farm.py <config.json> [--rounds <n>] [--only <producer regex>] [--seed <first seed>] [--programs <n per round>]

Every program is made from a (producer, seed) pair, so any result can be replayed:

    python3 farm.py <config.json> --replay <producer> <seed> [--form <name>] [--mode <name>] [--keep <folder>]

A program is run once by plain Bun for reference. Then, for every form of build in the config, it is built with
`bun build --compile --aot` and the executable is run in every collector mode the form lists. The result is one of

    same        the executable printed what plain Bun printed
    rejected    the build refused the program with an error message (a type error, most of the time)
    refused     the executable reported a value that does not match its type; a finding only for producers whose programs are sound
    slow        a time limit ran out on a run that plain Bun also needed long for
    no-reference  plain Bun itself failed, so nothing can be compared

or a finding: CRASH (death by a signal), SANITIZER, ASSERTION, PANIC (of the build), HANG, DIFFERENT, REFUSED, NOT-COMPILED.

Findings go to <out>/finds/<signature>/ with the program, both outputs and a meta.json. The first finding of a signature that
no line of the known-differences file matches is appended to <out>/NEW.tsv. Counts go to <out>/counts.tsv, one line per round, form,
mode and producer.

The config:
    tests       the folder test/aot of the repository
    work        where programs and executables are written (a tmpfs: an executable is the size of Bun)
    out         where results are kept
    jobs        programs in flight
    build       a label for the build under test
    machine     a small integer; seeds of different machines do not overlap
    plain       the Bun that gives the reference
    forms       { <name>: { "bun": <path>, "build": <label>, "build_flags": [..], "build_env": {..}, "run_env": {..}, "modes": [..], "slowness": <factor>, "share": <0..1>, "stress_share": <0..1> } }
                "from_sources": true runs `bun run --aot <file>` in place of building an executable
                "bun" may hold a `*` where the label of the build stands: the newest build that is not listed as faulty is taken, anew at every round
    strip       [ { "from": <path with *>, "to": <path with *> } ]: the newest build's Bun is copied without its debug information
    since       the number of the oldest build to take
    faulty      a file whose lines begin with the labels of builds to pass over
    cores       a file that holds the list of processors to stay on, read at every round
    known       the file of known differences: <regex over "producer verdict detail origin"> <tab> <reason>
"""
import collections, concurrent.futures, glob, hashlib, json, os, random, re, resource, shutil, signal, subprocess, sys, threading, time

resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import producers as producers_module

MODES = {
    "plain": {},
    "full": {"BUN_JSC_slowPathAllocsBetweenGCs": "3", "BUN_JSC_useZombieMode": "1", "BUN_JSC_scribbleFreeCells": "1"},
    "young": {"BUN_JSC_slowPathAllocsBetweenGCs": "3", "BUN_JSC_useZombieMode": "1", "BUN_JSC_scribbleFreeCells": "1", "BUN_JSC_useEdenCollectionsAtSlowPathAllocs": "1"},
}
FINDINGS = ("CRASH", "SANITIZER", "ASSERTION", "PANIC", "HANG", "DIFFERENT", "REFUSED", "NOT-COMPILED")
BASE_ENV = {
    "PATH": "/usr/bin:/bin",
    "NO_COLOR": "1",
    "BUN_ENABLE_CRASH_REPORTING": "0",
    "DO_NOT_TRACK": "1",
    "BUN_DEBUG_QUIET_LOGS": "1",
    "BUN_INSTALL_CACHE_DIR": "/nonexistent",
    "TZ": "Etc/UTC",
    "ASAN_SYMBOLIZER_PATH": "/usr/lib/llvm-21/bin/llvm-symbolizer",
    "WTF_numberOfProcessorCores": "2",
    "UV_THREADPOOL_SIZE": "2",
    "GOMAXPROCS": "2",
    "ASAN_OPTIONS": "detect_leaks=0:allow_user_segv_handler=1:allocator_may_return_null=1:abort_on_error=0:symbolize=1:detect_stack_use_after_return=0",
}


def run(command, cwd, seconds, env):
    """Returns (exit code, stdout, stderr, seconds). The exit code is negative for a signal and None when the time ran out."""
    started = time.time()
    child = subprocess.Popen(command, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        out, err = child.communicate(timeout=seconds)
        code = child.returncode
    except subprocess.TimeoutExpired:
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        out, err = child.communicate()
        code = None
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    return code, out.decode(errors="replace"), err.decode(errors="replace"), time.time() - started


def masked(text):
    text = re.sub(r"0x[0-9a-fA-F]+", "0xN", text)
    text = re.sub(r"/[\w./-]*/(\w[\w.-]*)", r"\1", text)
    return re.sub(r"\d+", "N", text)


def crash_detail(code, said):
    """What identifies a crash, as far as the output tells: the sanitizer's report, the assertion, or the signal and the kind of address."""
    found = re.search(r"ERROR: (\w+Sanitizer): ([\w-]+)", said)
    if found:
        frames = re.findall(r"^\s+#\d+ 0x[0-9a-f]+ in (.+?)(?: \(?/|\s+\S+:\d+|$)", said, flags=re.M)
        frames = [f for f in frames if not re.match(r"__asan|__interceptor|__sanitizer", f)][:4]
        return "SANITIZER", found.group(2) + " | " + " < ".join(f[:90] for f in frames)
    found = re.search(r"(ASSERTION FAILED|ARGUMENT BAD|SHOULD NEVER BE REACHED|FATAL ERROR)[^\n]*\n?([^\n]*)", said)
    if found:
        return "ASSERTION", (found.group(0).replace("\n", " | "))[:260]
    found = re.search(r"UNCHECKED EXCEPTION|Unchecked JS exception|ERROR: Unchecked", said)
    if found:
        at = re.search(r"Unchecked exception[^\n]*\n[^\n]*\n?[^\n]*", said)
        return "ASSERTION", "unchecked exception | " + masked((at.group(0) if at else "")[:200]).replace("\n", " | ")
    found = re.search(r"panic(?:ked)?[ (:][^\n]*", said)
    name = signal.Signals(-code).name if code is not None and code < 0 else "exit %s" % code
    if found:
        text = found.group(0)
        address = re.search(r"at address (0x[0-9A-Fa-f]+)", text)
        if address:
            value = int(address.group(1), 16)
            kind = "null page" if value < 0x10000 else "boxed value" if value >> 48 else "heap or code"
            return "CRASH", "%s | %s | %s" % (name, re.sub(r" at address .*", "", text)[:80], kind)
        return "CRASH", "%s | %s" % (name, masked(text)[:200])
    return "CRASH", name


def died(code, said):
    if code is not None and code < 0:
        return True
    if code is not None and code >= 128 and code not in (130, 143):
        return True
    return bool(re.search(r"ERROR: \w+Sanitizer|ASSERTION FAILED|SHOULD NEVER BE REACHED|oh no: Bun has crashed|Unchecked JS exception", said))


def without_noise(text):
    return re.sub(r" [0-9]+ms$", "", text, flags=re.M)


def is_refused_line(ours, theirs):
    what = ours[: ours.rfind(": ") + 2]
    threw = lambda answer: sum(word in answer for word in ("THROWS", "caught", "T:"))
    return len(what) > 1 and theirs.startswith(what) and threw(ours[len(what):]) > threw(theirs[len(what):])


def processors(text):
    found = set()
    for part in text.split(","):
        first, _, last = part.partition("-")
        found.update(range(int(first), int(last or first) + 1))
    return found


def newest(pattern, faulty, since=0):
    """The path that matches the pattern for the newest build, and that build's label."""
    if "*" not in pattern:
        return (pattern, "?") if os.path.exists(pattern) else None
    before, after = pattern.split("*", 1)
    best = None
    for path in glob.glob(pattern):
        label = path[len(before): len(path) - len(after)]
        number = re.match(r"B(\d+)[a-z]?$", label)
        if number and int(number.group(1)) >= since and label not in faulty and os.access(path, os.X_OK):
            best = max(best or (0,), (int(number.group(1)), label, path))
    return (best[2], best[1]) if best else None


class Farm:
    def __init__(self, config_path):
        self.config_path = config_path
        self.lock = threading.Lock()
        self.load()
        self.seen = set()
        finds = os.path.join(self.out, "finds")
        os.makedirs(finds, exist_ok=True)
        self.seen.update(os.listdir(finds))
        self.base_verdicts = {}

    def load(self):
        c = json.load(open(self.config_path))
        self.config = c
        self.tests, self.work, self.out = c["tests"], c["work"], c["out"]
        self.jobs, self.machine = c["jobs"], c.get("machine", 0)
        faulty = set()
        if os.path.exists(c.get("faulty", "")):
            faulty = {line.split()[0] for line in open(c["faulty"]) if line.strip()}
        for job in c.get("strip", []):
            found = newest(job["from"], faulty, c.get("since", 0))
            to = found and job["to"].replace("*", found[1])
            if found and not os.path.exists(to):
                os.makedirs(os.path.dirname(to), exist_ok=True)
                if subprocess.run(["strip", "--strip-debug", "-o", to + ".new", found[0]]).returncode == 0:
                    os.replace(to + ".new", to)
        self.forms = {}
        for name, form in c["forms"].items():
            found = newest(form["bun"], faulty, c.get("since", 0))
            if found:
                self.forms[name] = dict(form, bun=found[0], build=form.get("build") or found[1])
        self.plain, self.build = newest(c["plain"], faulty)
        if os.path.exists(c.get("cores", "")):
            os.sched_setaffinity(0, processors(open(c["cores"]).read().strip()))
        self.known = []
        path = c.get("known") or os.path.join(HERE, "known-differences.tsv")
        if os.path.exists(path):
            for line in open(path):
                if line.strip() and not line.startswith("#"):
                    pattern, _, reason = line.rstrip("\n").partition("\t")
                    self.known.append((re.compile(pattern), reason))
        os.makedirs(self.work, exist_ok=True)
        os.makedirs(self.out, exist_ok=True)

    def env(self, *more):
        env = dict(BASE_ENV, HOME=self.work, TMPDIR=self.work)
        for m in more:
            env.update(m or {})
        return env

    def reference(self, folder, program):
        if program.expected is not None:
            return 0, program.expected, "", 1.0
        code, out, err, took = run([self.plain, "run", program.main if program.cwd else "./" + program.main], program.cwd or folder, 60, self.env(program.plain_env))
        return code, without_noise(out), err, took

    def judge_run(self, program, reference, code, out, err):
        """Compares a finished run of the executable with the reference."""
        ref_code, ref_out, ref_err, _ = reference
        out = without_noise(out)
        if program.expected is not None:
            first_error = next((line for line in err.split("\n") if re.match(r"(error|[A-Za-z]*Error)\b", line)), "")
            out, code = out + ("exit code %d\n%s\n" % (code, first_error) if code else err), 0
        said = out + err
        if out == ref_out and (code == 0) == (ref_code == 0):
            return "same", ""
        ours, theirs = out.split("\n"), ref_out.split("\n")
        departing = []
        for i in range(max(len(ours), len(theirs))):
            a, b = ours[i] if i < len(ours) else "<end>", theirs[i] if i < len(theirs) else "<end>"
            if a != b and not (program.lines_may_be_refused and is_refused_line(a, b)):
                departing.append((i, a, b))
        if not departing and (code == 0) == (ref_code == 0):
            return "same", ""
        reported = "(bun compile" in said
        if reported and program.lines_may_be_refused:
            return "refused", ""
        is_refusal = lambda a, b: "(bun compile" in a or (bool(re.search(r"TypeError|THROWS|REFUSED", a)) and not re.search(r"TypeError|THROWS|REFUSED", b))
        if departing and not is_refusal(departing[0][1], departing[0][2]):
            reported = False
        i, a, b = departing[0] if departing else (0, "", "")
        detail = "line %d: compiled %r | plain %r | exits %s %s" % (i + 1, a[:100], b[:100], code, ref_code)
        if reported or (departing and re.search(r"TypeError|THROWS|REFUSED", a) and not re.search(r"TypeError|THROWS|REFUSED", b)):
            message = re.search(r"[^\n]*\(bun compile", said)
            if message and not program.may_be_refused:
                text = re.sub(r"^.*?(\w*Error: )", r"\1", message.group(0)).replace(" (bun compile", "")
                detail = re.sub(r'"(?:[^"\\]|\\.)*"', '".."', text)[:160] + " | " + detail
            return ("refused" if program.may_be_refused else "REFUSED"), detail
        if "Maximum call stack" in said + ref_out + ref_err:
            return "slow", "stack depth"
        error = re.search(r"^\w*Error[^\n]*", err, flags=re.M)
        return "DIFFERENT", detail + (" | " + error.group(0)[:100] if error else "")

    def one_form(self, folder, program, reference, name, form, modes):
        """Yields (mode, verdict, detail, output) for one form of build."""
        slowness = form.get("slowness", 1)
        if form.get("from_sources"):
            limit = max(60, reference[3] * 30) * slowness
            code, out, err, took = run([form["bun"], "run", "--aot", program.main if program.cwd else "./" + program.main], program.cwd or folder, limit, self.env(program.run_env, form.get("run_env")))
            if code is None:
                yield "plain", "slow", "", ""
            elif died(code, out + err):
                verdict, detail = crash_detail(code, out + err)
                yield "plain", verdict, detail, out + "\n---- stderr\n" + err
            elif code == 1 and re.search(r"^error: TS\d+:|error TS\d+:", out + err, flags=re.M):
                yield "build", "rejected", "", out + err
            else:
                verdict, detail = self.judge_run(program, reference, code, out, err)
                yield "plain", verdict, detail, out + "\n---- stderr\n" + err
            return
        executable = os.path.join(folder, "compiled")
        if os.path.exists(executable):
            os.remove(executable)
        command = [form["bun"], "build", "--compile", "--aot", *form.get("build_flags", []), *program.build_flags, program.main if program.cwd else "./" + program.main, "--outfile", executable]
        code, out, err, took = run(command, program.cwd or folder, 240 * slowness, self.env(form.get("build_env")))
        said = out + err
        if code is None:
            yield "build", "HANG" if reference[3] < 20 else "slow", "the build ran for %d s" % took, said
            return
        if died(code, said) or re.search(r"\bpanicked at|thread '[^']*' panicked|internal compiler error", said):
            verdict, detail = crash_detail(code, said)
            yield "build", "PANIC" if verdict == "CRASH" else verdict, "the build: " + detail, said
            return
        if not os.path.exists(executable):
            if re.search(r"^error: .*(could not be compiled|cannot be compiled|not compiled)", said, flags=re.M | re.I):
                yield "build", "NOT-COMPILED", masked(re.search(r"^error: [^\n]*", said, flags=re.M).group(0))[:200], said
            else:
                yield "build", "rejected", "", said
            return
        try:
            for mode in modes:
                stress = 1 if mode == "plain" else 8
                limit = min(600, max(30, reference[3] * 20) * slowness * stress)
                code, out, err, took = run([executable], program.cwd or folder, limit, self.env(program.run_env, form.get("run_env"), MODES[mode]))
                if code is None and mode == "plain" and reference[3] < 3:
                    code, out, err, took = run([executable], program.cwd or folder, limit * 5, self.env(program.run_env, form.get("run_env"), MODES[mode]))
                    if code is None:
                        yield mode, "HANG", "ran for %d s, plain Bun for %.1f s" % (took, reference[3]), out + err
                        continue
                if code is None:
                    yield mode, "slow", "", ""
                elif died(code, out + err):
                    verdict, detail = crash_detail(code, out + err)
                    yield mode, verdict, detail, out + "\n---- stderr\n" + err
                else:
                    verdict, detail = self.judge_run(program, reference, code, out, err)
                    yield mode, verdict, detail, out + "\n---- stderr\n" + err
        finally:
            if os.path.exists(executable):
                os.remove(executable)

    def is_known(self, producer, verdict, detail, origin=""):
        text = "%s %s %s %s" % (producer, verdict, detail, origin)
        for pattern, reason in self.known:
            if pattern.search(text):
                return reason
        return None

    def record(self, program, folder, reference, form, mode, verdict, detail, output):
        family = program.producer.split(":")[0] if verdict in ("CRASH", "SANITIZER", "ASSERTION", "PANIC") else program.producer
        key = "%s %s" % (verdict, masked(detail.split(" | line ")[0] if verdict == "REFUSED" and " | line " in detail else detail) if verdict in ("DIFFERENT", "REFUSED", "HANG") else detail)
        if verdict in ("DIFFERENT", "REFUSED", "HANG", "NOT-COMPILED"):
            key = family + " " + key
        signature = verdict.lower() + "-" + hashlib.md5(key.encode()).hexdigest()[:10]
        known = self.is_known(program.producer, verdict, detail, program.origin)
        where = os.path.join(self.out, "finds", signature)
        with self.lock:
            first = signature not in self.seen
            self.seen.add(signature)
            os.makedirs(where, exist_ok=True)
            count = len([n for n in os.listdir(where) if n.startswith("case-")])
        build = self.forms.get(form, {}).get("build", self.build)
        line = "\t".join([time.strftime("%m-%d %H:%M:%S"), build, form, mode, program.producer, str(program.seed), verdict, signature, detail.replace("\t", " ").replace("\n", " ")[:300], program.origin])
        with self.lock:
            open(os.path.join(self.out, "all-finds.tsv"), "a").write(line + "\n")
            if first and not known:
                open(os.path.join(self.out, "NEW.tsv"), "a").write(line + "\n")
        if count < 5:
            case = os.path.join(where, "case-%s-%s-%s-%s" % (program.producer.replace(":", "_").replace("/", "_"), program.seed, form, mode))
            os.makedirs(case, exist_ok=True)
            for name, text in program.files.items():
                path = os.path.join(case, name)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                open(path, "w").write(text)
            open(os.path.join(case, "compiled.txt"), "w").write(output[-200000:])
            open(os.path.join(case, "plain.txt"), "w").write(reference[1][-200000:] + "\n---- stderr\n" + reference[2][-20000:])
            json.dump({"producer": program.producer, "seed": program.seed, "form": form, "mode": mode, "build": build, "bun": self.forms.get(form, {}).get("bun", self.plain), "verdict": verdict, "detail": detail, "known": known, "main": program.main, "from": program.origin, "time": time.strftime("%Y-%m-%d %H:%M:%S")}, open(os.path.join(case, "meta.json"), "w"), indent=1)
        return signature

    def one(self, producer, seed, forms=None, modes=None, keep=None):
        """Makes one program and judges it in every form. Returns [(form, mode, verdict, detail)]."""
        try:
            program = producer.make(seed)
        except producers_module.NoProgram:
            return [("-", "-", "no-program", "")]
        folder = keep or os.path.join(self.work, "p-%d-%s-%d" % (os.getpid(), re.sub(r"\W", "_", producer.name), seed))
        shutil.rmtree(folder, ignore_errors=True)
        results = []
        try:
            os.makedirs(folder, exist_ok=True)
            for name, text in program.files.items():
                path = os.path.join(folder, name)
                os.makedirs(os.path.dirname(path), exist_ok=True)
                open(path, "w").write(text)
            reference = self.reference(folder, program)
            if reference[0] is None:
                return [("-", "-", "no-reference", "slow")]
            if died(reference[0], reference[1] + reference[2]):
                verdict, detail = crash_detail(reference[0], reference[1] + reference[2])
                self.record(program, folder, reference, "plain-bun", "plain", verdict, "plain Bun: " + detail, reference[1] + reference[2])
                return [("plain-bun", "plain", verdict, detail)]
            if reference[0] != 0 and not program.reference_may_fail:
                return [("-", "-", "no-reference", "exit %d" % reference[0])]
            rng = random.Random(seed)
            for name, form in self.forms.items():
                if forms and name not in forms:
                    continue
                if not forms and rng.random() > form.get("share", 1):
                    continue
                if form.get("from_sources") and (program.expected is not None or "BUN_JSC_crashIfInterpreterIsUsed" in program.run_env or program.build_flags):
                    continue
                if program.cwd and os.path.getmtime(program.main) > os.path.getmtime(form["bun"]) - 1500:
                    results.append((name, "-", "newer-than-build", ""))
                    continue
                wanted = modes or [m for m in form.get("modes", ["plain"]) if m == "plain" or rng.random() < form.get("stress_share", 1)]
                for mode, verdict, detail, output in self.one_form(folder, program, reference, name, form, wanted):
                    results.append((name, mode, verdict, detail))
                    if verdict in FINDINGS:
                        self.record(program, folder, reference, name, mode, verdict, detail, output)
                if results and results[-1][2] == "rejected":
                    break
            return results
        finally:
            if not keep:
                shutil.rmtree(folder, ignore_errors=True)

    def round(self, number, first_seed, per_round, only):
        self.load()
        chosen = [p for p in producers_module.all_producers(self.tests, self) if not only or re.search(only, p.name)]
        weight = sum(p.weight for p in chosen)
        jobs = []
        seed = first_seed
        for p in chosen:
            for _ in range(max(1, round(per_round * p.weight / weight))):
                jobs.append((p, p.seed_for(seed)))
                seed += 1
        random.Random(first_seed).shuffle(jobs)
        counts, unwritten = collections.Counter(), collections.Counter()
        started = time.time()

        def write():
            stamp = time.strftime("%Y-%m-%d %H:%M:%S")
            with open(os.path.join(self.out, "counts.tsv"), "a") as f:
                for (form, mode, name, verdict), n in sorted(unwritten.items()):
                    f.write("\t".join([stamp, self.forms.get(form, {}).get("build", self.build), form, mode, name, verdict, str(n), str(first_seed), str(seed)]) + "\n")
            unwritten.clear()

        with concurrent.futures.ThreadPoolExecutor(self.jobs) as pool:
            futures = {pool.submit(self.safely, p, s): p for p, s in jobs}
            for finished, future in enumerate(concurrent.futures.as_completed(futures), 1):
                for form, mode, verdict, _ in future.result():
                    counts[(form, mode, futures[future].name, verdict)] += 1
                    unwritten[(form, mode, futures[future].name, verdict)] += 1
                if finished % 100 == 0:
                    write()
        write()
        stamp = time.strftime("%Y-%m-%d %H:%M:%S")
        total = collections.Counter()
        for (form, mode, name, verdict), n in counts.items():
            total[verdict] += n
        builds = " ".join("%s=%s" % (name, form["build"]) for name, form in self.forms.items())
        print("%s round %d | %s | seeds %d..%d | %d programs | %d s | %s" % (stamp, number, builds, first_seed, seed, len(jobs), time.time() - started, " ".join("%s %d" % kv for kv in total.most_common())), flush=True)
        return seed

    def safely(self, producer, seed):
        try:
            return self.one(producer, seed)
        except Exception as e:
            with self.lock:
                open(os.path.join(self.out, "farm-errors.txt"), "a").write("%s %s %s: %r\n" % (time.strftime("%H:%M:%S"), producer.name, seed, e))
            return [("-", "-", "farm-error", repr(e))]


def main():
    arguments = sys.argv[1:]

    def option(name, default=None):
        if name in arguments:
            at = arguments.index(name)
            value = arguments[at + 1]
            del arguments[at:at + 2]
            return value
        return default

    rounds, only, per_round = int(option("--rounds", 0)), option("--only"), int(option("--programs", 2000))
    seed, form, mode, keep = option("--seed"), option("--form"), option("--mode"), option("--keep")
    if "--replay" in arguments:
        at = arguments.index("--replay")
        name, replay_seed = arguments[at + 1], int(arguments[at + 2])
        del arguments[at:at + 3]
        farm = Farm(arguments[0])
        producer = next(p for p in producers_module.all_producers(farm.tests, farm) if p.name == name)
        for result in farm.one(producer, replay_seed, [form] if form else None, [mode] if mode else None, keep):
            print("\t".join(result))
        return
    farm = Farm(arguments[0])
    state = os.path.join(farm.out, "next-seed")
    next_seed = int(seed) if seed else int(open(state).read()) if os.path.exists(state) else farm.machine * 1000000000 + 1000
    number = 0
    while not os.path.exists(os.path.join(farm.out, "STOP")):
        number += 1
        next_seed = farm.round(number, next_seed, per_round, only)
        open(state + ".new", "w").write(str(next_seed))
        os.replace(state + ".new", state)
        if rounds and number >= rounds:
            break


if __name__ == "__main__":
    main()
