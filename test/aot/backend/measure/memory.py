#!/usr/bin/env python3
"""What the tracker's server process holds in memory: at idle, under load, after the load, and after forced collections. Linux only.

    python3 memory.py <folder with the executables and load> <golden folder> <rows.jsonl> aot,jit,released,go,rust,aot.gc,jit.gc,released.gc

Each column runs alone on $SERVER_CORES with the client on $CLIENT_CORES, against $DATABASE_URL. One line of JSON per column:

    ready          2 s after the first response
    load_median    under the mix (256 connections) for $SECONDS (30): the median of samples 0.25 s apart over the second half
    load_highest   the highest of the same samples
    after10        10 s after the load has stopped
    after40        40 s after it

Every reading has the fields of /proc/<pid>/smaps_rollup (Rss, Pss, Anonymous, LazyFree, Private_Dirty ..) and RssAnon, RssFile and
RssShmem of /proc/<pid>/status, in kB. <reading>_mappings has the resident kB by kind of mapping: [Rss, Private_Dirty, Anonymous less
LazyFree].

A column whose name ends in .gc is the same program behind memory-entry.ts, which on SIGUSR2 runs two full collections and writes the
engine's own account (heapStats of bun:jsc) from before and after them. It gets the signal twice: at the end of the load, with the
load still on (report_load, load_gc: what is alive with 256 requests in flight), and 40 s after it (report, gc, gc10).
The rest of what is resident is dead or free room in the heap's blocks, memory that malloc keeps, and files.

memory_table.py prints the rows as Markdown. memory_kinds.py says what the anonymous pages hold, from a trace of page faults.
"""
import collections, json, os, re, signal, socket, statistics, subprocess, sys, time

folder, golden, rows_file, columns = sys.argv[1:5]
SERVER_CORES, CLIENT_CORES = os.environ.get("SERVER_CORES", "0"), os.environ.get("CLIENT_CORES", "1-2")
SECONDS, TMP = float(os.environ.get("SECONDS", "30")), os.environ.get("TMP_DIR", "/tmp")


def read_totals(pid):
    totals = {name: int(value) for name, value in re.findall(r"^(\w+):\s+(\d+) kB", open("/proc/%d/smaps_rollup" % pid).read(), re.M)}
    totals.update((name, int(value)) for name, value in re.findall(r"^(RssAnon|RssFile|RssShmem|VmHWM|Threads):\s+(\d+)", open("/proc/%d/status" % pid).read(), re.M))
    return totals


def kind_of_mapping(permissions, name, size_kb, executable):
    if name == executable:
        return "executable: code" if "x" in permissions else "executable: data written to" if "w" in permissions else "executable: read-only data (the AoT image too)"
    if name.startswith("/"):
        return "shared libraries and other files"
    if name.startswith("[stack"):
        return "stacks"
    if name == "[heap]":
        return "brk heap"
    if name.startswith("["):
        return "vdso and the like"
    if "x" in permissions:
        return "anonymous, executable (JIT code)"
    return "anonymous: " + ("up to 64 KB" if size_kb <= 64 else "up to 1 MB" if size_kb <= 1024 else "up to 32 MB" if size_kb <= 32768 else "over 32 MB")


def read_mappings(pid, executable):
    kinds, kind = collections.defaultdict(lambda: [0, 0, 0]), None
    for line in open("/proc/%d/smaps" % pid):
        head = re.match(r"([0-9a-f]+)-([0-9a-f]+) (\S+) \S+ \S+ \S+\s*(.*)$", line)
        if head:
            kind = kinds[kind_of_mapping(head.group(3), head.group(4), (int(head.group(2), 16) - int(head.group(1), 16)) // 1024, executable)]
            continue
        field = re.match(r"(Rss|Private_Dirty|Anonymous|LazyFree):\s+(\d+) kB", line)
        if field:
            kb = int(field.group(2))
            if field.group(1) == "Rss":
                kind[0] += kb
            elif field.group(1) == "Private_Dirty":
                kind[1] += kb
            else:
                kind[2] += kb if field.group(1) == "Anonymous" else -kb
    return dict(kinds)


def write_exchanges(port, work):
    """Writes the requests of the mix with their expected responses for load.c and returns the file names in its order."""
    names = []
    for index, exchange in enumerate(json.load(open(os.path.join(golden, "mix.json"), encoding="utf-8"))):
        body = None if exchange["body"] is None else exchange["body"].encode()
        head = "%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n" % (exchange["method"], exchange["path"], port) + "".join(header + "\r\n" for header in exchange["headers"])
        if body is not None:
            head += "Content-Length: %d\r\n" % len(body)
        names += [os.path.join(work, "request-%d" % index), os.path.join(work, "expected-%d" % index)]
        open(names[-2], "wb").write(head.encode() + b"\r\n" + (body or b""))
        open(names[-1], "wb").write(("%d\n%s\n%s\n" % (exchange["status"], exchange["kind"], exchange["check"])).encode() + exchange["answer"].encode())
    return names


def collect(process, report):
    """Asks the server for two full collections and returns what it wrote about them."""
    process.send_signal(signal.SIGUSR2)
    for _ in range(200):
        if os.path.exists(report) and os.path.getsize(report):
            break
        time.sleep(0.05)
    time.sleep(0.2)
    written = json.load(open(report))
    os.remove(report)
    return written


for number, column in enumerate(columns.split(",")):
    port, executable, language = 21700 + number, os.path.join(folder, column), column.split(".")[0]
    work = os.path.join(TMP, "memory-" + column)
    os.makedirs(work, exist_ok=True)
    report = os.path.join(work, "report.json")
    env = dict(os.environ, PORT=str(port), NODE_ENV="production", BUN_ENABLE_CRASH_REPORTING="0", DO_NOT_TRACK="1", MEMORY_REPORT=report, DATABASE_POOL="64" if language in ("go", "rust") else "4")
    env.pop("GOMAXPROCS", None)
    env.update({"go": {"GODEBUG": "gctrace=1"}, "rust": {"MIMALLOC_ALLOW_THP": "0"}}.get(language, {"WTF_numberOfProcessorCores": "1"}))
    log = open(os.path.join(work, "server.log"), "wb")
    server = subprocess.Popen(["taskset", "-c", SERVER_CORES, executable], env=env, stdout=log, stderr=log)
    for _ in range(400):
        try:
            connection = socket.create_connection(("127.0.0.1", port), timeout=1)
            connection.sendall(b"GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
            while connection.recv(65536):
                pass
            connection.close()
            break
        except OSError:
            time.sleep(0.02)
    row = {"column": column}
    time.sleep(2)
    row["ready"], row["ready_mappings"] = read_totals(server.pid), read_mappings(server.pid, executable)
    load = subprocess.Popen(["taskset", "-c", CLIENT_CORES, os.path.join(folder, "load"), str(port), "256", "100000000", "2"] + write_exchanges(port, work), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    began, samples = time.time(), []
    while time.time() - began < SECONDS:
        time.sleep(0.25)
        if time.time() - began > SECONDS / 2:
            samples.append(read_totals(server.pid))
    row["load_mappings"] = read_mappings(server.pid, executable)
    if column.endswith(".gc"):
        row["report_load"] = collect(server, report)
        row["load_gc"] = read_totals(server.pid)
    load.kill()
    load.wait()
    row["load_median"] = {name: statistics.median(sample.get(name, 0) for sample in samples) for name in samples[0]}
    row["load_highest"] = {name: max(sample.get(name, 0) for sample in samples) for name in samples[0]}
    time.sleep(10)
    row["after10"] = read_totals(server.pid)
    time.sleep(30)
    row["after40"], row["after40_mappings"] = read_totals(server.pid), read_mappings(server.pid, executable)
    if column.endswith(".gc"):
        row["report"] = collect(server, report)
        time.sleep(1)
        row["gc"], row["gc_mappings"] = read_totals(server.pid), read_mappings(server.pid, executable)
        time.sleep(10)
        row["gc10"] = read_totals(server.pid)
    server.kill()
    server.wait()
    if language == "go":
        row["gctrace"] = [line for line in open(os.path.join(work, "server.log"), errors="replace") if line.startswith("gc ")][-3:]
    open(rows_file, "a").write(json.dumps(row) + "\n")
    print("%-12s RSS, kB: ready %d, under load %d, highest %d, 40 s after %d" % (column, row["ready"]["Rss"], row["load_median"]["Rss"], row["load_highest"]["Rss"], row["after40"]["Rss"]), flush=True)
