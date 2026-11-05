#!/usr/bin/env python3
"""Builds, checks and measures one of the two applications in this folder against Go and Rust, and prints the tables. Linux only.

    python3 card.py tracker --bun <bun> --released <released bun> --out <folder>
    python3 card.py shop    --bun <bun> --released <released bun> --out <folder>

`tracker` is ./tracker (an issue tracker). `shop` is ./app (the TechEmpower tests and a shop). This script runs the commands of
their README.md files in one go, so that a table can be repeated for every build of Bun without hand work.

It needs perf, taskset, cc, strip, psql, go and cargo, and a running Postgres that is pinned to cores of its own:

    DATABASE_URL       the database that schema.sql fills. For the tracker its role must be allowed to create databases.
    POSTMASTER_PID     $(head -1 "$PGDATA/postmaster.pid")
    POSTGRES_CORES     the cores Postgres is pinned to, for example 8-15
    SERVER_CORES       one core, for example 0
    CLIENT_CORES       for example 1-2
    SPARE_CORES        shop only: four cores on which the columns of a group run side by side, for example 0,1,2,3
    CARRIER_CORES      shop only: the core of the other HTTP service
    EVENTS             optional: more hardware events for measure/measure.py to count per request, for example ic_cache_fill_l2

The columns:

    aot            <bun> build --compile --aot
    aot.previous   <previous bun> build --compile --aot, with --previous
    jit            <bun> build --compile: the same Bun as a JIT
    released       <released bun> build --compile
    go, rust       rivals/go, rivals/rust

The steps (--steps, all by default, in this order):

    load       fills the database from schema.sql
    build      <out>/bin: executables built by stripped copies of the Buns, as they ship. <out>/sym: the same with symbols, for `layers`.
    golden     the requests with their expected responses
    compare    tracker only: every request of exchanges.ts to every column, each on its own copy of the database; responses must be identical
    pieces     tracker only: the microbenchmarks of tracker/pieces: user instructions and cycles per issue
    rows       tracker only: what a query and a row cost the SQL driver (a line through results of 3, 30 and 300 rows)
    rates      measure/measure.py under continuous load: requests per second, instructions, cycles, CPU time, memory, latency
    layers     measure/measure.py with LAYERS=yes: cycles and instructions per request by the layer that owns the code
    memory     tracker only: measure/memory.py: what the server process holds at idle, under the mix, after it, and after forced collections
    tables     prints everything as Markdown; also written to <out>/card.md

On a machine without a network: --modules <node_modules with @types/bun, and zod for the shop>, --go-vendor <folder with go.sum and
vendor/>, --cargo-lock <Cargo.lock>, and a $CARGO_HOME/config.toml that replaces crates.io with vendored sources.
"""
import argparse, os, re, shutil, socket, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
STEPS = ["load", "build", "golden", "compare", "pieces", "rows", "rates", "layers", "memory", "tables"]
TRACKER_TESTS = "mix,issue,list,home,profile,api-issue,api-list,api-user,comment"
PIECES = ["page", "json", "markdown", "dates", "escape", "thread"]
QUIET = {"NO_COLOR": "1", "BUN_ENABLE_CRASH_REPORTING": "0", "DO_NOT_TRACK": "1", "BUN_DEBUG_QUIET_LOGS": "1"}

parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
parser.add_argument("application", choices=["tracker", "shop"])
parser.add_argument("--bun", required=True)
parser.add_argument("--released", required=True)
parser.add_argument("--previous")
parser.add_argument("--out", required=True)
parser.add_argument("--steps", default=",".join(STEPS))
parser.add_argument("--tests", help="tests for `rates`; all by default")
parser.add_argument("--layer-tests", help="tests for `layers`")
parser.add_argument("--columns", help="columns for `rates`; all that were built by default")
parser.add_argument("--starts", type=int, default=2, help="fresh processes per test and column")
parser.add_argument("--seconds", type=int, default=35, help="how long each process is loaded; the rate is read from --read-from on")
parser.add_argument("--read-from", type=int, default=15)
parser.add_argument("--modules")
parser.add_argument("--go-vendor")
parser.add_argument("--cargo-lock")
options = parser.parse_args()

tracker = options.application == "tracker"
source = os.path.join(HERE, "tracker") if tracker else HERE
out = os.path.abspath(options.out)
steps = options.steps.split(",")
environment = dict(os.environ, **QUIET)
database_url = os.environ.get("DATABASE_URL", "")
for folder in ("bin", "sym", "logs", "work", "golden", "tmp"):
    os.makedirs(os.path.join(out, folder), exist_ok=True)


def run(command, log, **more):
    with open(os.path.join(out, "logs", log), "a") as file:
        file.write("$ %s\n" % " ".join(command))
        file.flush()
        done = subprocess.run(command, stdout=file, stderr=subprocess.STDOUT, **{"env": environment, **more})
    if done.returncode != 0:
        sys.exit("%s failed; the end of %s:\n%s" % (" ".join(command[:6]), os.path.join(out, "logs", log), open(os.path.join(out, "logs", log), errors="replace").read()[-2000:]))


def psql(database, *commands, capture=False):
    words = ["psql", re.sub(r"/[^/]*$", "/" + database, database_url), "-q", "-tA", "-v", "ON_ERROR_STOP=1"]
    for command in commands:
        words += ["-f", command[1:]] if command.startswith("@") else ["-c", command]
    done = subprocess.run(words, capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit("psql: " + done.stderr[-600:])
    return done.stdout.strip() if capture else None


DATABASE = database_url.rsplit("/", 1)[-1]


def copy_database(name):
    psql("postgres", "DROP DATABASE IF EXISTS %s" % name, "CREATE DATABASE %s TEMPLATE %s" % (name, DATABASE))
    return re.sub(r"/[^/]*$", "/" + name, database_url)


def copy_tree(origin, destination, **more):
    shutil.copytree(origin, destination, **more)
    subprocess.run(["chmod", "-R", "u+w", destination])


def lay_out(name, *overlays):
    folder = os.path.join(out, "work", name)
    shutil.rmtree(folder, ignore_errors=True)
    for overlay in overlays:
        copy_tree(overlay, folder, dirs_exist_ok=True)
    if options.modules:
        os.symlink(os.path.abspath(options.modules), os.path.join(folder, "node_modules"))
    else:
        run([os.path.abspath(options.bun), "install", "--ignore-scripts"], "build.txt", cwd=folder)
    return folder


def build_native(destination, symbols):
    go = os.path.join(out, "work", "go")
    shutil.rmtree(go, ignore_errors=True)
    copy_tree(os.path.join(source, "rivals", "go"), go)
    flags = []
    if options.go_vendor:
        for name in os.listdir(options.go_vendor):
            if name in ("go.mod", "go.sum", "vendor") and (name != "go.mod" or not tracker):
                path = os.path.join(options.go_vendor, name)
                copy_tree(path, os.path.join(go, name)) if os.path.isdir(path) else shutil.copy(path, go)
        flags = ["-mod=vendor"]
    run(["go", "build", *flags, "-trimpath", "-ldflags=" + ("" if symbols else "-s -w"), "-o", os.path.join(destination, "go"), "."], "build.txt", cwd=go)
    rust = os.path.join(out, "work", "rust-tree")
    shutil.rmtree(rust, ignore_errors=True)
    copy_tree(os.path.join(source, "rivals", "rust"), os.path.join(rust, "rivals", "rust"))
    if tracker:
        copy_tree(os.path.join(source, "pieces"), os.path.join(rust, "pieces"))
    if options.cargo_lock:
        shutil.copy(options.cargo_lock, os.path.join(rust, "rivals", "rust", "Cargo.lock"))
    target = os.path.join(out, "work", "rust-target")
    run(["cargo", "build", "--release"], "build.txt", cwd=os.path.join(rust, "rivals", "rust"), env=dict(environment, CARGO_TARGET_DIR=target))
    shutil.copy(os.path.join(target, "release", "tracker" if tracker else "backend"), os.path.join(destination, "rust"))
    if tracker:
        shutil.copy(os.path.join(target, "release", "pieces"), os.path.join(out, "work", "pieces-rust"))


def build():
    app = os.path.join(source, "app")
    plain = lay_out("app", app)
    for folder, symbols in (("bin", False), ("sym", True)):
        destination = os.path.join(out, folder)
        buns = {}
        for name, bun in (("bun", options.bun), ("released", options.released), ("previous", options.previous)):
            if bun:
                buns[name] = os.path.join(out, "work", "%s-%s" % (name, folder))
                shutil.copy(bun, buns[name])
                if not symbols:
                    subprocess.run(["strip", "-s", buns[name]], stderr=subprocess.DEVNULL)
        columns = [("aot", "bun", plain, ["--aot"]), ("jit", "bun", plain, []), ("released", "released", plain, [])]
        if options.previous:
            columns.append(("aot.previous", "previous", plain, ["--aot"]))
        for column, bun, folder_of_sources, flags in columns:
            run([buns[bun], "build", "--compile", *flags, "--target=bun", "./server.ts", "--outfile", os.path.join(destination, column)], "build.txt", cwd=folder_of_sources, env=dict(environment, **({"BUN_JSC_aotMapFilePath": os.path.join(destination, column + ".map")} if flags else {})))
        if tracker and not symbols:
            for column, bun, folder_of_sources, flags in columns[:3]:
                shutil.copy(os.path.join(HERE, "measure", "memory-entry.ts"), folder_of_sources)
                run([buns[bun], "build", "--compile", *flags, "--target=bun", "./memory-entry.ts", "--outfile", os.path.join(destination, column + ".gc")], "build.txt", cwd=folder_of_sources)
        if not tracker:
            run([buns["released"], "build", "--compile", "--target=bun", "./carrier.ts", "--outfile", os.path.join(destination, "carrier")], "build.txt", cwd=plain)
            shutil.copy(os.path.join(destination, "aot"), os.path.join(destination, "aot.2"))
        build_native(destination, symbols)
        run(["cc", "-O2", "-pthread", "-o", os.path.join(destination, "load"), os.path.join(HERE, "measure", "load.c")], "build.txt")
    if tracker:
        pieces = os.path.join(out, "pieces")
        os.makedirs(pieces, exist_ok=True)
        tree = os.path.join(out, "work", "pieces-tree")
        shutil.rmtree(tree, ignore_errors=True)
        copy_tree(plain, os.path.join(tree, "app"), symlinks=True)
        copy_tree(os.path.join(source, "pieces"), os.path.join(tree, "pieces"))
        os.symlink(os.path.join(tree, "app", "node_modules"), os.path.join(tree, "node_modules"))
        for column, bun, flags in (("aot", options.bun, ["--aot"]), ("released", options.released, [])) + ((("aot.previous", options.previous, ["--aot"]),) if options.previous else ()):
            run([os.path.abspath(bun), "build", "--compile", *flags, "--target=bun", "./main.ts", "--outfile", os.path.join(pieces, column)], "build.txt", cwd=os.path.join(tree, "pieces"))
        go = os.path.join(out, "work", "go")
        os.remove(os.path.join(go, "main.go"))
        shutil.copy(os.path.join(source, "pieces", "main.go"), go)
        run(["go", "build", *(["-mod=vendor"] if options.go_vendor else []), "-trimpath", "-o", os.path.join(pieces, "go"), "."], "build.txt", cwd=go)
        shutil.copy(os.path.join(out, "work", "pieces-rust"), os.path.join(pieces, "rust"))


def built(folder, wanted):
    return [column for column in wanted if os.path.exists(os.path.join(out, folder, column))]


def start_server(executable, port, url, more=()):
    log = open(os.path.join(out, "logs", "server-%d.txt" % port), "wb")
    process = subprocess.Popen([executable], env=dict(environment, PORT=str(port), DATABASE_URL=url, DATABASE_POOL="4", NODE_ENV="production", **dict(more)), stdout=log, stderr=log)
    for _ in range(400):
        try:
            socket.create_connection(("127.0.0.1", port), timeout=1).close()
            return process
        except OSError:
            time.sleep(0.05)
    sys.exit("%s did not listen on %d" % (executable, port))


def golden():
    if not tracker:
        run([os.path.abspath(options.released), os.path.join(HERE, "answers.ts"), os.path.join(out, "golden")], "golden.txt")
        return
    server = start_server(os.path.join(out, "bin", "released"), 21500, copy_database("card_golden"))
    try:
        run([os.path.abspath(options.released), os.path.join(source, "exchanges.ts"), "write", os.path.join(out, "golden"), "21500"], "golden.txt", env=dict(environment, DATABASE_URL=database_url))
    finally:
        server.kill()
        server.wait()
        psql("postgres", "DROP DATABASE card_golden")


def compare():
    servers, words = [], []
    for index, column in enumerate(built("bin", ["aot", "released", "go", "rust"])):
        more = {"BUN_JSC_crashIfInterpreterIsUsed": "1"} if column == "aot" else {}
        servers.append(start_server(os.path.join(out, "bin", column), 21501 + index, copy_database("card_copy_%d" % index), more.items()))
        words.append("%s=%d" % (column, 21501 + index))
    try:
        run([os.path.abspath(options.released), os.path.join(source, "exchanges.ts"), "compare", *words], "compare.txt", env=dict(environment, DATABASE_URL=database_url))
    finally:
        for index, server in enumerate(servers):
            server.kill()
            server.wait()
            psql("postgres", "DROP DATABASE card_copy_%d" % index)


def count(command, more=()):
    report = os.path.join(out, "tmp", "stat.csv")
    env = dict(environment, WTF_numberOfProcessorCores="1", MIMALLOC_ALLOW_THP="0", **dict(more))
    done = subprocess.run(["taskset", "-c", os.environ.get("SERVER_CORES", "0"), "perf", "stat", "-x,", "-e", "instructions:u,cycles:u", "-o", report, "--"] + command, env=env, capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit("%s: exit %d: %s" % (" ".join(command), done.returncode, (done.stdout + done.stderr)[-400:]))
    counted = {line.split(",")[2].split(":")[0]: int(line.split(",")[0]) for line in open(report) if line.count(",") > 3 and line[0].isdigit()}
    return counted["instructions"], counted["cycles"], done.stdout


def pieces():
    folder = os.path.join(out, "pieces")
    with open(os.path.join(folder, "issues.txt"), "w") as file:
        file.write(psql(DATABASE, "@" + os.path.join(source, "pieces", "export.sql"), capture=True) + "\n")
    with open(os.path.join(out, "pieces.tsv"), "w") as file:
        for piece in PIECES:
            for column in built("pieces", ["aot", "aot.previous", "released", "go", "rust"]):
                command = [os.path.join(folder, column), piece, os.path.join(folder, "issues.txt")]
                few, many = count(command + ["200"]), count(command + ["400"])
                file.write("%s\t%s\t%d\t%d\n" % (piece, column, (many[0] - few[0]) / 4000, (many[1] - few[1]) / 4000))


def rows():
    issues = [psql(DATABASE, "SELECT id FROM issues WHERE comment_count = %d ORDER BY id LIMIT 1" % size, capture=True) for size in (3, 30, 300)]
    with open(os.path.join(out, "rows.tsv"), "w") as file:
        for column in built("pieces", ["aot", "aot.previous", "released", "go", "rust"]):
            cost = []
            for issue in issues:
                command, more = [os.path.join(out, "pieces", column), "rows", issue], {"DATABASE_URL": database_url, "DATABASE_POOL": "1"}.items()
                cost.append((count(command + ["3000"], more)[0] - count(command + ["1000"], more)[0]) / 2000)
            per_row = (cost[2] - cost[0]) / 297
            file.write("%s\t%d\t%d\n" % (column, per_row, cost[0] - 3 * per_row))


def measure(name, folder, tests, columns, **more):
    rows_file = os.path.join(out, name + ".tsv")
    for path in (rows_file, rows_file + ".symbols"):
        if os.path.exists(path):
            os.remove(path)
    settings = dict(CONTINUOUS="yes", LOADED_STARTS=options.starts, WARM_SECONDS=options.seconds, READ_FROM=options.read_from, LONGEST=15, STARTS=3, COUNTER_ROUNDS=1, PACED_ROUNDS=1, SETTLE=3, TMP_DIR=os.path.join(out, "tmp"),
                    GO_RUN_ENV="DATABASE_POOL=%d" % (64 if tracker else 16), RUST_RUN_ENV="DATABASE_POOL=%d,MIMALLOC_ALLOW_THP=0" % (64 if tracker else 16), DATABASE_POOL=4 if tracker else 2)
    settings.update(more)
    env = dict(environment, **{key: str(value) for key, value in settings.items()})
    carriers = []
    if tracker:
        env.update(DATABASE_URL=copy_database("card_run"), WARM="10000")
    else:
        carriers = [subprocess.Popen(["taskset", "-c", os.environ.get("CARRIER_CORES", "0"), os.path.join(out, folder, "carrier")], env=dict(environment, PORT="21390", WTF_numberOfProcessorCores="1"), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)]
        env.update(CARRIER_URL="http://127.0.0.1:21390", CARRIER_PIDS=str(carriers[0].pid))
        time.sleep(0.5)
    try:
        run(["taskset", "-c", os.environ.get("CLIENT_CORES", "1-3"), sys.executable, os.path.join(HERE, "measure", "measure.py"), os.path.join(out, folder), os.path.join(out, "golden"), rows_file, tests, ",".join(columns)], name + ".txt", env=env)
    finally:
        for carrier in carriers:
            carrier.kill()
        if tracker:
            psql("postgres", "DROP DATABASE card_run")


def rates():
    if tracker:
        measure("rates", "bin", options.tests or TRACKER_TESTS, options.columns.split(",") if options.columns else built("bin", ["aot", "aot.previous", "released", "go", "rust"]))
        return
    side_by_side = dict(PACED_ROUNDS=0, LONGEST=25, READ_FROM=20, WARM_SECONDS=max(50, options.seconds))
    first = "+".join(built("bin", ["aot", "aot.previous", "released", "jit"]))
    measure("rates-quote", "bin", "quote", ["aot", "released", "jit", "aot.2", "go", "rust"], WARM=40000, TOGETHER="aot+released+jit/aot.2+go+rust", **side_by_side)
    measure("rates", "bin", options.tests or "db,queries20,fortunes,updates20,json,plaintext", first.split("+") + ["aot.2", "go", "rust"], TOGETHER=first + "/aot.2+go+rust", **side_by_side)


def profile_layers():
    alone = dict(LAYERS="yes", LOADED_STARTS=1, STARTS=1, PACED_ROUNDS=0, SETTLE=0, WARM_SECONDS=25, READ_FROM=15, SPARE_CORES="")
    columns = built("sym", ["aot", "jit", "released", "go", "rust"])
    measure("layers", "sym", options.layer_tests or ("mix,issue,list,api-issue,api-list" if tracker else "db,queries20,fortunes,updates20,json,quote"), columns, **alone)


def memory():
    rows_file = os.path.join(out, "memory.jsonl")
    if os.path.exists(rows_file):
        os.remove(rows_file)
    columns = built("bin", ["aot", "jit", "released", "go", "rust", "aot.gc", "jit.gc", "released.gc"])
    try:
        run([sys.executable, os.path.join(HERE, "measure", "memory.py"), os.path.join(out, "bin"), os.path.join(out, "golden"), rows_file, ",".join(columns)], "memory.txt", env=dict(environment, DATABASE_URL=copy_database("card_memory"), TMP_DIR=os.path.join(out, "tmp")))
    finally:
        psql("postgres", "DROP DATABASE card_memory")


def tables():
    text = []
    names = {"aot": "--aot", "aot.previous": "--aot, previous Bun", "released": "released Bun", "go": "Go", "rust": "Rust"}
    for title, name, width in (("Microbenchmarks: user instructions / user cycles per issue", "pieces.tsv", 4), ("SQL driver: user instructions per row / per query", "rows.tsv", 3)):
        path = os.path.join(out, name)
        if not os.path.exists(path):
            continue
        cells = [line.rstrip("\n").split("\t") for line in open(path)]
        cells = [(["cost"] if width == 3 else []) + line for line in cells]
        columns = list(dict.fromkeys(line[1] for line in cells))
        text.append("**%s**\n\n| | %s |\n|---|%s" % (title, " | ".join(names[column] for column in columns), "---:|" * len(columns)))
        for row in dict.fromkeys(line[0] for line in cells):
            text.append("| %s | %s |" % (row, " | ".join("{:,} / {:,}".format(int(line[2]), int(line[3])) for column in columns for line in cells if line[:2] == [row, column])))
        text.append("")
    found = [os.path.join(out, name) for name in ("rates-quote.tsv", "rates.tsv") if os.path.exists(os.path.join(out, name))]
    if found:
        text.append(subprocess.run([sys.executable, os.path.join(HERE, "measure", "table.py"), *found], capture_output=True, text=True, env=dict(os.environ, COMPARE="yes" if tracker else "no")).stdout)
        if not tracker:
            text.append("```\n" + subprocess.run([sys.executable, os.path.join(HERE, "measure", "pairs.py"), *found], capture_output=True, text=True).stdout + "```\n")
    if os.path.exists(os.path.join(out, "layers.tsv")):
        printed = subprocess.run([sys.executable, os.path.join(HERE, "measure", "table.py"), os.path.join(out, "layers.tsv")], capture_output=True, text=True).stdout
        text.append(printed[printed.index("**", printed.index("by layer**") - 80):] if "by layer**" in printed else "")
    if os.path.exists(os.path.join(out, "memory.jsonl")):
        text.append(subprocess.run([sys.executable, os.path.join(HERE, "measure", "memory_table.py"), os.path.join(out, "memory.jsonl")], capture_output=True, text=True).stdout)
    if os.path.exists(os.path.join(out, "logs", "compare.txt")):
        text.append("Responses compared: " + open(os.path.join(out, "logs", "compare.txt")).read().strip().split("\n")[-1])
    open(os.path.join(out, "card.md"), "w").write("\n".join(text) + "\n")
    print("\n".join(text))


ACTIONS = {"load": lambda: psql(DATABASE, "@" + os.path.join(source, "schema.sql")), "build": build, "golden": golden, "compare": compare, "pieces": pieces, "rows": rows, "rates": rates, "layers": profile_layers, "memory": memory, "tables": tables}
for step in STEPS:
    if step in steps and (tracker or step not in ("compare", "pieces", "rows", "memory")):
        began = time.time()
        ACTIONS[step]()
        print("%-8s %4d s" % (step, time.time() - began), file=sys.stderr, flush=True)
