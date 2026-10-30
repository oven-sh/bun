#!/usr/bin/env python3
"""Says what the anonymous memory of a server process holds, from a trace of its page faults. Linux only; the trace needs root.

Every resident anonymous page is given to the call chain of the last page fault on it, and that chain to a kind: strings, the SQL
driver, JIT code and tables, and so on. The nearest frame that a rule matches decides, allocator frames left out, six frames deep: on a
server nearly everything runs under the frame of the socket that woke the event loop, so a match anywhere in the chain would charge
everything to that socket's owner. The executable must have symbols and frame pointers.

  1. Record every user page fault on the core the server will be pinned to, from before its start:
         perf record -o faults.data -a -C <core> -c 1 -m 64M --user-callchains -e "exceptions:page_fault_user/call-graph=fp/" -- sleep 60
  2. Start the server (taskset -c <core>) and load it. At the moment of interest:
         python3 memory_kinds.py snapshot <pid> <folder>
     It stops the process, writes the state of every page and the time, and lets the process go on.
  3. perf script -i faults.data -F comm,pid,tid,time,event,trace,ip,sym,dso | gzip > <folder>/faults.txt.gz
  4. python3 memory_kinds.py table aot=<folder> jit=<folder> ..   [--unmatched 20: the heaviest chains that no rule took]
     A name is the executable's file name: it picks the process out of everything that ran on that core.

MB = 2^20 bytes.
"""
import collections, gzip, os, re, signal, struct, sys

RULES = [(kind, re.compile(pattern)) for kind, pattern in (
    ("ICU", r"icu_\d+::|_\d\d$|^u[a-z]+_[a-zA-Z]+_\d\d"),
    ("TLS certificates", r"us_load_system_certificates|RootCertificates|bssl::|X509|ASN1_|PEM_|BUF_MEM|us_get_root|system_certs"),
    ("SQL driver (buffers, statements, cells, rows)", r"bun_sql|[Pp]ostgres|SQLClient|SQLQuery|DataCell|data_cell"),
    ("HTTP server and sockets (buffers, requests, responses)", r"uWS::|^us_|^uws_|bsd_|HttpContext|HttpResponse|RequestContext|bun_runtime::server|bun_uws|NodeHTTP|FetchHeaders|WebCore::|Blob|Body"),
    ("AoT: by-name lookup table and inline cache data", r"PropertyLookupTable|AOT::Data::create|cacheKeyed|cacheNamed|AndCache|InlineCache"),
    ("AoT: typed objects, layouts, closures, module variables", r"AOT::"),
    ("JIT: code, plans, side tables", r"JIT|DFG::|FTL::|B3::|Air::|LinkBuffer|ExecutableAllocator|MacroAssembler|PolymorphicAccess|StructureStubInfo|CallLinkInfo|Baseline"),
    ("bytecode and its metadata, parser, source text", r"CodeBlock|BytecodeGenerator|Unlinked|MetadataTable|JSC::Parser|JSC::Lexer|ASTBuilder|SourceProvider|ParserArena|FunctionExecutable|ScriptExecutable|CodeCache|VariableEnvironment"),
    ("property tables, Structures' extras", r"PropertyTable|JSC::Structure"),
    ("strings: ropes flattened", r"JSRopeString"),
    ("strings: other", r"AtomString|StringImpl|WTF::String|StringBuilder|Joiner|NumericStrings|clone_latin1|clone_utf|bun_core::string|jsString|JSString|BunString|simdutf|Stringifier"),
    ("Maps, Sets, arrays, storage out of line", r"constructMap|constructSet|OrderedHashTable|JSMap|JSSet|WeakMap|Butterfly|JSArray"),
    ("collector: mark stacks, block handles, directories", r"SlotVisitor|BlockDirectory|MarkedBlock|MarkedSpace|JSC::Heap|Collector|Subspace|GCSegmentedArray|MarkStack"),
    ("regular expressions", r"Yarr|RegExp"),
    ("VM and global object creation", r"JSC::VM::|JSGlobalObject::init|GlobalObject::finishCreation|VirtualMachine|JSC::initialize"),
    ("threads (stacks, TLS, parking)", r"pthread|start_thread|thread_start|ParkingLot|__cxa_thread_atexit|WTF::Thread"),
    ("process start (loader, libc, allocator set-up)", r"_dl_|dl_main|__libc_early|mi_process|mi_thread_init|init_tls|allocate_dtv"),
    ("promises, microtasks, event loop", r"Promise|[Mm]icrotask|event_loop|EventLoop"),
    ("other engine helpers", r"^operation|^JSC::|^WTF::"),
    ("Go: goroutine stacks", r"runtime\.(newstack|morestack|copystack|stackalloc|malg|newproc)"),
    ("Go: heap and run time", r"^runtime\."),
    ("Rust: tokio, hyper, axum", r"tokio|hyper|axum|tower"),
    ("Rust: Postgres client", r"postgres|deadpool"),
)]
ALLOCATOR = re.compile(r"^_?mi_|malloc|^mem(set|move|cpy)|operator new|bmalloc|^pas_|__rust_alloc|__rdl_|RawVec|raw_vec|finish_grow|do_reserve|alloc::alloc|\[unknown\]|realloc|calloc")
FAULT = re.compile(r"^(.{0,30}?)\s+(-?\d+)/(-?\d+)\s+(\d+\.\d+):\s+(?:\d+\s+)?[\w:\-]+(?:/[^/]*/)?:\s?address=0x([0-9a-f]+)")


def kind_of(chain):
    for frame in [frame for frame in chain if not ALLOCATOR.search(frame)][:6]:
        for kind, pattern in RULES:
            if pattern.search(frame):
                return kind
    return "other"


def snapshot(pid, folder):
    """One line per mapping and one character per page: a: present and anonymous, f: present, of a file, s: swapped, '.': absent."""
    os.makedirs(folder, exist_ok=True)
    os.kill(pid, signal.SIGSTOP)
    try:
        open(os.path.join(folder, "time"), "w").write(open("/proc/uptime").read().split()[0])
        with open("/proc/%d/maps" % pid) as maps, open("/proc/%d/pagemap" % pid, "rb", buffering=0) as pagemap, open(os.path.join(folder, "pages"), "w") as pages:
            for line in maps:
                fields = line.split(None, 5)
                low, high = (int(address, 16) for address in fields[0].split("-"))
                if low >= 1 << 47 or high - low > 1 << 34:
                    continue
                pagemap.seek((low >> 12) * 8)
                states = "".join(("f" if entry >> 61 & 1 else "a") if entry >> 63 & 1 else "s" if entry >> 62 & 1 else "." for (entry,) in struct.iter_unpack("<Q", pagemap.read((high - low) >> 9)))
                pages.write("%x %x %s %s\n%s\n" % (low, high, fields[1], fields[5].strip() if len(fields) > 5 else "", states))
    finally:
        os.kill(pid, signal.SIGCONT)


def read_faults(folder, name):
    """Returns the call chain of the last fault on every page of the process called `name`, up to the time of the snapshot."""
    until = float(open(os.path.join(folder, "time")).read())
    chains, names, current, frames = collections.defaultdict(dict), collections.defaultdict(set), None, []
    with gzip.open(os.path.join(folder, "faults.txt.gz"), "rt", errors="replace") as file:
        for line in file:
            fault = FAULT.match(line)
            if fault:
                if current:
                    chains[current[0]][current[1]] = tuple(frames)
                names[int(fault.group(2))].add(fault.group(1).strip())
                current, frames = ((int(fault.group(2)), int(fault.group(5), 16) >> 12) if float(fault.group(4)) <= until else None), []
            elif current and line[:1] in "\t " and line.strip():
                words = line.split(None, 1)
                if len(words) == 2:
                    symbol = words[1].rstrip("\n")
                    frames.append(symbol[:symbol.rfind(" (")].split("+0x")[0] if " (" in symbol else symbol)
    if current:
        chains[current[0]][current[1]] = tuple(frames)
    return chains[max([pid for pid in chains if name[:15] in names[pid]] or list(chains), key=lambda pid: len(chains[pid]))]


def count_pages(folder, name, unmatched):
    last_fault, table = read_faults(folder, name), collections.defaultdict(collections.Counter)
    lines = open(os.path.join(folder, "pages")).read().split("\n")
    for head, states in zip(lines[0::2], lines[1::2]):
        low, high, permissions, mapped = (head.split(" ", 3) + [""])[:4]
        low, high = int(low, 16), int(high, 16)
        region = (
            "stacks" if mapped.startswith("[stack") else "written data of the executable and of libraries" if mapped.startswith("/") else "JIT code (anonymous, executable)" if "x" in permissions
            else "Structures (their own space)" if high - low == 1 << 32 else "heap and malloc"
        )
        for index, state in enumerate(states):
            if state != "a":
                continue
            chain = last_fault.get((low >> 12) + index)
            kind = "" if region != "heap and malloc" else "(no fault seen)" if chain is None else kind_of(chain)
            if kind == "other":
                unmatched[" < ".join(frame[:44] for frame in chain[:7])] += 1
            table[region][kind] += 1
    return table


def print_table(words):
    show = 0
    if "--unmatched" in words:
        index = words.index("--unmatched")
        show = int(words[index + 1])
        del words[index:index + 2]
    tables = {}
    for word in words:
        name, folder = word.split("=", 1)
        unmatched = collections.Counter()
        tables[name] = count_pages(folder, name, unmatched)
        for chain, pages in unmatched.most_common(show):
            print("%s: %6.2f MB  %s" % (name, pages / 256, chain), file=sys.stderr)
    print("| what holds the resident anonymous pages, MB | " + " | ".join(tables) + " |\n|---|" + "---:|" * len(tables))
    print("| **all** | " + " | ".join("**%.1f**" % (sum(sum(kinds.values()) for kinds in table.values()) / 256) for table in tables.values()) + " |")
    for region in sorted({region for table in tables.values() for region in table}, key=lambda region: -max(sum(table[region].values()) for table in tables.values())):
        print("| **%s** | " % region + " | ".join("**%.1f**" % (sum(table[region].values()) / 256) for table in tables.values()) + " |")
        for kind in sorted({kind for table in tables.values() for kind in table[region] if kind}, key=lambda kind: -max(table[region][kind] for table in tables.values())):
            if max(table[region][kind] for table in tables.values()) >= 13:
                print("| . %s | " % kind + " | ".join("%.2f" % (table[region][kind] / 256) if table[region][kind] else "" for table in tables.values()) + " |")


if __name__ == "__main__":
    if sys.argv[1:2] == ["snapshot"] and len(sys.argv) == 4:
        snapshot(int(sys.argv[2]), sys.argv[3])
    elif sys.argv[1:2] == ["table"] and len(sys.argv) > 2:
        print_table(sys.argv[2:])
    else:
        sys.exit(__doc__)
