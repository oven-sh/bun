import random, sys, itertools
rnd = random.Random(20260930)

def hx(b):
    if isinstance(b, str):
        b = b.encode('utf-8', 'surrogatepass')
    return b.hex() if b else '-'

out = []

# ---------- path pieces ----------
ROOTS = ['', '/', '//', '///', '\\', '\\\\', '\\/', '/\\', 'c:', 'c:/', 'C:/', 'c:\\', 'C:\\', 'c:a', 'z:/', '1:/', '^/', '^', '^\\',
         'file:///', 'file://', 'file:///c:/', 'file:///c:', 'file:///c%3a/', 'file:///c%3A', 'file:///c%3ad', 'file:///c:d',
         'file://localhost/c:/', 'file://localhost/', 'file://server/', 'http://server/', 'http://server', 'http://', '://', 'a://b/',
         '//server/', '//server/share/', '//server', '\\\\server\\share\\', '//Server/', '//sErVeR/share/', 'c:d://x/', '^/://', 'é://x/']
NAMES = ['', '.', '..', '...', 'a', 'b', 'A', 'B', 'proj', 'Proj', 'src', 'a.ts', 'A.TS', '.a', 'a.', '..a', 'a..', 'c:', ' ', 'é', 'É',
         'k', 'K', '\u212a', 'ß', '\u1e9e', 'σ', 'ς', 'Σ', 'ǆ', 'ǅ', 'Ǆ', 'ı', 'İ', 'i', 'I', '\U00010428', '\U00010400', '\ufffd',
         'file:', 'http:', 'localhost', '%3a', ':', '^', 'x://y']
RAW = [b'\xff', b'\xfe', b'\xc3', b'\xc3\x28', b'\xed\xa0\x80', b'\xf0\x9f', b'\xe2\x80']
SEPS = ['/', '/', '/', '\\', '//', '/./', '/../']

def rand_path():
    root = rnd.choice(ROOTS) if rnd.random() < 0.8 else ''
    n = rnd.randrange(0, 6)
    parts = []
    for _ in range(n):
        if rnd.random() < 0.06:
            parts.append(rnd.choice(RAW))
        else:
            parts.append(rnd.choice(NAMES).encode())
    b = root.encode()
    for i, p in enumerate(parts):
        if i > 0:
            b += rnd.choice(SEPS).encode()
        b += p
    if rnd.random() < 0.2:
        b += rnd.choice(['/', '\\', '//', '/.', '/..']).encode()
    return b

def rand_abs_dir():
    root = rnd.choice(['/', '/', '/', 'c:/', 'C:\\', '//server/share/', '', 'proj', '^/', 'file:///', 'z:/'])
    n = rnd.randrange(0, 4)
    b = root.encode() + '/'.join(rnd.choice(['proj', 'Proj', 'a', 'A', 'src', 'é', 'É', 'k', '\u212a', 'b', 'sub']) for _ in range(n)).encode()
    if rnd.random() < 0.1:
        b += b'/'
    return b

# ---------- R: roots ----------
alphabet = ['/', '\\', 'c', ':', '^', 'a', '%', '3', 'A', 'f', 'i', 'l', 'e', 'x', '.', 'é']
for n in range(0, 5):
    for t in itertools.product(['/', '\\', 'c', ':', '^', 'a'], repeat=n):
        out.append('R ' + hx(''.join(t)))
for r in ROOTS:
    for suffix in ['', 'a', '/', 'a/b', '/a', ':', '3a', 'd', '/d']:
        out.append('R ' + hx(r + suffix))
for _ in range(20000):
    n = rnd.randrange(0, 14)
    out.append('R ' + hx(''.join(rnd.choice(alphabet) for _ in range(n))))
for _ in range(5000):
    out.append('R ' + hx(rand_path()))
for s in ['file:///c:', 'file:///c:/', 'file:///c:/x', 'file:///c%3a', 'file:///c%3A/', 'file:///c%3a/x', 'file:///c%3ax', 'file:///c%3', 'file:///c%',
          'file://localhost/c:', 'file://localhost/c:/', 'file://localhost/c%3a/', 'file://localhostx/c:/', 'file://LOCALHOST/c:/', 'FILE:///c:/',
          'file:///1:/', 'file:///cc:/', 'file:////c:/', 'file:///', 'file://', 'file:/', 'file:', 'x://', 'x:///', '://x', '://', ':///', 'a/b://c/d', 'c:/a://b']:
    out.append('R ' + hx(s))

# ---------- N: normalized absolute ----------
small = ['', '.', '..', 'a', '...', 'a.']
for root in ['', '/', 'c:/', 'c:', '//s/', '^/', 'x://h/']:
    for n in range(0, 5):
        for t in itertools.product(small, repeat=n):
            p = root + '/'.join(t)
            out.append('N ' + hx(p) + ' ' + hx('/proj'))
            if n <= 3:
                out.append('N ' + hx(p) + ' -')
                out.append('N ' + hx(p + '/') + ' ' + hx('/proj/sub'))
                out.append('N ' + hx('./' + p) + ' ' + hx('C:\\proj'))
for _ in range(40000):
    out.append('N ' + hx(rand_path()) + ' ' + hx(rand_abs_dir() if rnd.random() < 0.9 else rand_path()))

# ---------- C: convert to relative ----------
for _ in range(40000):
    cwd = rand_abs_dir() if rnd.random() < 0.9 else rand_path()
    if rnd.random() < 0.5:
        # A path under or beside the current directory, with the case of some letters changed.
        base = cwd
        if rnd.random() < 0.5:
            base = bytes((c ^ 0x20) if (65 <= (c & ~0x20) <= 90 and rnd.random() < 0.3) else c for c in base)
        if rnd.random() < 0.3:
            base = base.replace('é'.encode(), 'É'.encode()).replace(b'k', '\u212a'.encode())
        p = base + rnd.choice([b'', b'/', b'/a.ts', b'/src/a.ts', b'/../b.ts', b'/./c.ts', b'\\d.ts', b'/..', b'/../..', b'/../../..'])
    else:
        p = rand_path()
    out.append('C ' + hx(p) + ' ' + hx(cwd) + ' ' + rnd.choice(['0', '1']))

# ---------- F: fold equality ----------
RUNES = ['a', 'A', 'k', 'K', '\u212a', 's', 'S', '\u017f', 'ß', '\u1e9e', 'σ', 'ς', 'Σ', 'ǆ', 'ǅ', 'Ǆ', 'ı', 'İ', 'i', 'I', 'é', 'É', 'µ', 'μ', 'Μ',
         '\U00010428', '\U00010400', '\ufffd', 'z', 'Z', '0', '/', '@', '`', '[', '{', '\u00e5', '\u00c5', '\u212b', 'θ', 'ϑ', 'Θ', 'ϴ', '\u1c80', 'в', 'В']
for a in RUNES:
    for b in RUNES:
        out.append('F ' + hx(a) + ' ' + hx(b))
for _ in range(30000):
    def rs():
        n = rnd.randrange(0, 6)
        b = b''
        for _ in range(n):
            b += rnd.choice(RAW) if rnd.random() < 0.1 else rnd.choice(RUNES).encode()
        return b
    a = rs()
    if rnd.random() < 0.5:
        b = rs()
    else:
        # The same text with the case of some letters changed.
        b = a.decode('utf-8', 'surrogateescape')
        b = ''.join((c.swapcase() if len(c.swapcase()) == 1 and rnd.random() < 0.5 else c) for c in b).encode('utf-8', 'surrogateescape')
    out.append('F ' + hx(a) + ' ' + hx(b))

# ---------- L / U: line maps and UTF-16 lengths ----------
PIECES = [b'a', b'b', b' ', b'\n', b'\r', b'\r\n', '\u2028'.encode(), '\u2029'.encode(), '\u0085'.encode(), 'é'.encode(), '😀'.encode(), '\u2027'.encode(), '\u202a'.encode(),
          b'\xe2', b'\x80', b'\xa8', b'\xa9', b'\xe2\x80', b'\xff', b'\xc0\x8a', b'\xed\xa0\x80', b'\xf0\x9f', b'\xf0\x9f\x98', b'\xf4\x90\x80\x80', b'\xe0\x80\xa8', '\ufeff'.encode(), b'\t', b'\x0b', b'\x0c']
for n in range(0, 4):
    for t in itertools.product(PIECES[:16], repeat=n):
        out.append('L ' + hx(b''.join(t)))
for _ in range(20000):
    n = rnd.randrange(0, 30)
    out.append('L ' + hx(b''.join(rnd.choice(PIECES) for _ in range(n))))
for _ in range(5000):
    n = rnd.randrange(0, 24)
    out.append('L ' + hx(bytes(rnd.choice([0x0a, 0x0d, 0x61, 0xe2, 0x80, 0xa8, 0xa9, 0xc3, 0xa9, 0xf0, 0x9f, 0x98, 0x80, 0xff, 0xed, 0xa0, 0xc2, 0x85]) for _ in range(n))))
for _ in range(30000):
    n = rnd.randrange(0, 40)
    if rnd.random() < 0.5:
        out.append('U ' + hx(b''.join(rnd.choice(PIECES) for _ in range(n))))
    else:
        out.append('U ' + hx(bytes(rnd.randrange(0, 256) if rnd.random() < 0.5 else rnd.choice([0x61, 0xc3, 0xa9, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]) for _ in range(n))))
# every pair and triple of bytes decodes as Go decodes it
for a in range(0x80, 0x100):
    for b in range(0x70, 0x100, 1):
        out.append('U ' + bytes([a, b]).hex())
for a in [0xe0, 0xe1, 0xec, 0xed, 0xee, 0xef, 0xf0, 0xf1, 0xf3, 0xf4, 0xf5, 0xc1, 0xc2, 0xdf]:
    for b in range(0x7e, 0xc2):
        for c in [0x7f, 0x80, 0xbf, 0xc0, 0x41]:
            out.append('U ' + bytes([a, b, c]).hex())
            out.append('U ' + bytes([a, b, c, 0x80]).hex())
            out.append('U ' + bytes([a, b, c, 0xbf, 0x41]).hex())

# ---------- W: the plain writer ----------
MSG = ["Type 'string' is not assignable to type 'number'.", "Cannot find name 'x'.", "'}' expected.", 'é 😀 \t tab', '', ' ', '  indented', "Types of property 'a' are incompatible.", 'x' * 300, '\xff'.encode('latin1')]
def rand_text():
    n = rnd.randrange(0, 25)
    return b''.join(rnd.choice(PIECES[:14] + [b'let x = 1;', b'const s: number = "a";']) for _ in range(n))
def rand_name():
    r = rnd.random()
    if r < 0.5:
        return rnd.choice([b'/proj', b'/Proj', b'/other', b'c:/proj', b'C:/proj', b'//server/share', b'']) + b'/' + rnd.choice([b'a.ts', b'src/b.ts', 'é.ts'.encode(), b'sub/dir/c.tsx', b'A.TS', b'a b.ts'])
    if r < 0.8:
        return rand_path()
    return rnd.choice([b'a.ts', b'src/a.ts', b'./a.ts', b'../a.ts', b'^/untitled/a.ts', b'file:///proj/a.ts', b'http://h/a.ts'])
for _ in range(6000):
    nl = rnd.choice(['\n', '\n', '\r\n', '', '|'])
    cwd = rnd.choice([b'/proj', b'/proj', b'/proj/', b'/', b'', b'C:\\proj', b'c:/proj', b'/Proj', b'/proj/sub', b'//server/share', b'proj']) if rnd.random() < 0.9 else rand_path()
    cs = rnd.choice(['0', '1'])
    nfiles = rnd.randrange(0, 4)
    files = [(rand_name(), rand_text()) for _ in range(nfiles)]
    v = ['W', hx(nl), hx(cwd), cs, str(nfiles)]
    for name, text in files:
        v += [hx(name), hx(text)]
    nd = rnd.randrange(0, 5)
    v.append(str(nd))
    for _ in range(nd):
        fi = rnd.randrange(-1, nfiles) if nfiles else -1
        pos = rnd.randrange(0, len(files[fi][1]) + 1) if fi >= 0 else rnd.randrange(0, 5)
        v += [str(fi), str(pos), str(rnd.randrange(0, 4)), str(rnd.choice([1005, 2322, 2304, 0, 1, 18048, 4294967295 if False else 99999]))]
        m = rnd.choice(MSG)
        v.append(hx(m))
        # a chain in preorder: each level is at most one above the one before
        nchain = rnd.choice([0, 0, 0, 1, 2, 3, 5, 8])
        v.append(str(nchain))
        level = 0
        for _ in range(nchain):
            level = rnd.randrange(1, level + 2)
            v += [str(level), hx(rnd.choice(MSG))]
    out.append(' '.join(v))
# a deep chain
v = ['W', hx('\n'), hx('/proj'), '1', '1', hx('/proj/deep.ts'), hx('abc\ndef'), '1', '0', '5', '1', '2322', hx('top'), '400']
for level in range(1, 401):
    v += [str(level), hx('level %d' % level)]
out.append(' '.join(v))

open('vectors.txt', 'w').write('\n'.join(out) + '\n')
print(len(out), 'vectors')
