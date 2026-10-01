# Random diagnostics with many near-duplicates, as tokens that both probes read.
import copy, random, sys

rnd = random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 20260930)
CASES = int(sys.argv[2]) if len(sys.argv) > 2 else 20000

NAMES = ["/p/a.ts", "/p/b.ts", "/p/a.ts", "/p/A.ts", "/p/\u00e9.ts", "/p/a.tsx", "/q/a.ts", "/p/a"]
TEXTS = [b"", b"a", b"b", b"ab", b"a b", "\u00e9".encode(), b"\xff", b"A", b"a\nb", b"aa"]
SOURCES = ["", "a", "b", "no-x", "\u00e9", "B"]
NUMBERS = [0, 1, 2, 2322, 10000]


def hx(b):
    return "x" + b.hex()


def gen_chain(depth):
    n = rnd.choice([0, 0, 0, 1, 1, 2]) if depth < 3 else 0
    return [[rnd.choice(TEXTS), gen_chain(depth + 1)] for _ in range(n)]


def gen_code():
    if rnd.random() < 0.5:
        return ["T", rnd.choice(NUMBERS)]
    return ["N", rnd.choice(SOURCES)]


def gen_diag(nfiles, depth):
    return {
        "file": rnd.randrange(-1, nfiles),
        "start": rnd.choice([0, 1, 2, 7]),
        "length": rnd.choice([0, 1, 2]),
        "category": rnd.randrange(4),
        "code": gen_code(),
        "text": rnd.choice(TEXTS),
        "chain": gen_chain(0) if rnd.random() < 0.4 else [],
        "related": [gen_diag(nfiles, depth + 1) for _ in range(rnd.choice([0, 0, 0, 1, 1, 2, 3]))]
        if depth < 3
        else [],
    }


def mutate_chain(chain, depth):
    if chain and rnd.random() < 0.7:
        node = rnd.choice(chain)
        if rnd.random() < 0.5:
            node[0] = rnd.choice(TEXTS)
        else:
            mutate_chain(node[1], depth + 1)
    elif rnd.random() < 0.5 and chain:
        chain.pop(rnd.randrange(len(chain)))
    elif depth < 4:
        chain.insert(rnd.randrange(len(chain) + 1), [rnd.choice(TEXTS), gen_chain(depth + 1)])


def mutate(d, nfiles, depth):
    k = rnd.randrange(12)
    if k == 0:
        d["file"] = rnd.randrange(-1, nfiles)
    elif k == 1:
        d["start"] = rnd.choice([0, 1, 2, 7])
    elif k == 2:
        d["length"] = rnd.choice([0, 1, 2])
    elif k == 3:
        d["category"] = rnd.randrange(4)
    elif k == 4:
        d["code"] = gen_code()
    elif k == 5:
        d["text"] = rnd.choice(TEXTS)
    elif k in (6, 7):
        mutate_chain(d["chain"], 0)
    else:
        rel = d["related"]
        c = rnd.randrange(5)
        if c == 0 and rel:
            rel.pop(rnd.randrange(len(rel)))
        elif c == 1 and depth < 3:
            rel.insert(rnd.randrange(len(rel) + 1), gen_diag(nfiles, depth + 1))
        elif c == 2 and rel:
            rel.append(copy.deepcopy(rnd.choice(rel)))
        elif c == 3 and len(rel) > 1:
            rnd.shuffle(rel)
        elif rel and depth < 3:
            mutate(rnd.choice(rel), nfiles, depth + 1)


def ser_chain(out, chain):
    out.append(str(len(chain)))
    for text, nxt in chain:
        out.append(hx(text))
        ser_chain(out, nxt)


def ser(out, d):
    out += [str(d["file"]), str(d["start"]), str(d["length"]), str(d["category"])]
    kind, value = d["code"]
    out += [kind, str(value) if kind == "T" else hx(value.encode())]
    out.append(hx(d["text"]))
    ser_chain(out, d["chain"])
    out.append(str(len(d["related"])))
    for r in d["related"]:
        ser(out, r)


lines = [str(CASES)]
for _ in range(CASES):
    nfiles = rnd.randrange(0, 5)
    out = [str(nfiles)] + [hx(rnd.choice(NAMES).encode()) for _ in range(nfiles)]
    bases = [gen_diag(nfiles, 0) for _ in range(rnd.randrange(1, 4))]
    diags = []
    for _ in range(rnd.randrange(0, 9)):
        d = copy.deepcopy(rnd.choice(bases))
        for _ in range(rnd.choice([0, 0, 1, 1, 1, 2, 3])):
            mutate(d, nfiles, 0)
        diags.append(d)
    out.append(str(len(diags)))
    for d in diags:
        ser(out, d)
    lines.append(" ".join(out))
sys.stdout.write("\n".join(lines) + "\n")
