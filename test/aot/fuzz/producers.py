"""What makes the farm's programs. A producer turns a seed into a program, and the same seed always gives the same program.

    generated:<name>[:<language>]   test/aot/generated/python/<name>.py <seed>
    mutated:ts | mutated:js         a program of test/aot/programs, changed a little (the mutations of mutated-programs-same-output.test.ts)
    untyped:<name>                  the programs of a TypeScript generator after plain Bun has taken the types out
    border:ts                       the same programs with a statement inserted that does to an object in scope what untyped code may do to it
"""
import json, os, random, re, shutil, subprocess, sys, tempfile


class NoProgram(Exception):
    pass


class Program:
    def __init__(self, producer, seed, files, main, **more):
        self.producer, self.seed, self.files, self.main = producer, seed, files, main
        self.plain_env = more.get("plain_env") or {}
        self.run_env = more.get("run_env") or {}
        self.lines_may_be_refused = more.get("lines_may_be_refused", False)
        self.may_be_refused = more.get("may_be_refused", False)
        self.reference_may_fail = more.get("reference_may_fail", False)
        self.origin = more.get("origin", "")
        self.cwd = more.get("cwd")
        self.expected = more.get("expected")
        self.build_flags = more.get("build_flags") or []


class PythonGenerator:
    def __init__(self, folder, name, extension, options):
        self.path = os.path.join(folder, name + ".py")
        self.extension = extension
        self.generator = name
        self.lines_may_be_refused = "orThrows" in options
        self.plain_env = {"BUN_JSC_useRegExpJIT": "0"} if "withoutTheRegExpJIT" in options else {}
        language = re.search(r'as\("(\w+)"\)', options)
        self.words = (lambda seed: [seed, language.group(1)]) if language else (lambda seed: ["js", seed]) if 'words: seed => ["js", seed]' in options else (lambda seed: [seed])
        self.name = "generated:" + name + (":" + extension if language else "")
        self.fails_today = {int(n) for n in re.findall(r"(\d+): W", options)}
        self.count = None
        self.weight = 1.0
        text = open(self.path).read()
        if "sys.argv[1] == 'count'" in text:
            self.count = int(subprocess.run([sys.executable, "-B", self.path, "count"], stdout=subprocess.PIPE).stdout)
            self.weight = 0.5
        elif "once" in options:
            self.count, self.weight = 1, 0.02
            self.words = lambda seed: [1]
        elif name == "arrays-mutated-near-allocation":
            self.count, self.weight = 8, 0.05
        elif name == "many-structures-many-names":
            self.weight = 0.1
            self.words = lambda seed: [100 + seed % 2900]

    def seed_for(self, n):
        return n % self.count if self.count else n

    def make(self, seed):
        if seed in self.fails_today:
            raise NoProgram()
        done = subprocess.run([sys.executable, "-B", self.path, *map(str, self.words(seed))], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if done.returncode != 0:
            raise NoProgram()
        text, *others = done.stdout.decode().split("\n//// ")
        main = "main." + self.extension
        files = {other[: other.index("\n")]: other[other.index("\n") + 1:] + "\n" for other in others}
        files[main] = text + "\n" if others else text
        return Program(self.name, seed, files, main, plain_env=self.plain_env, lines_may_be_refused=self.lines_may_be_refused)


class WithoutTypes:
    """The programs of a TypeScript generator as JavaScript: plain Bun takes the types out. The compiler then has to infer what it was told before."""

    def __init__(self, generator, farm):
        self.generator, self.farm = generator, farm
        self.name = generator.name.replace("generated:", "untyped:")
        self.weight = generator.weight / 2

    def seed_for(self, n):
        return self.generator.seed_for(n)

    def make(self, seed):
        program = self.generator.make(seed)
        files = {}
        for name, text in program.files.items():
            if not name.endswith(".ts"):
                files[name] = text
                continue
            files[name[:-3] + ".js"] = self.strip(text)
        return Program(self.name, seed, files, program.main[:-3] + ".js", plain_env=program.plain_env, lines_may_be_refused=program.lines_may_be_refused)

    def strip(self, text):
        folder = tempfile.mkdtemp(dir=self.farm.work, prefix="strip-")
        try:
            open(os.path.join(folder, "in.ts"), "w").write(text)
            done = subprocess.run([self.farm.plain, "build", "--no-bundle", "--target=bun", "./in.ts"], cwd=folder, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60, env={"PATH": "/usr/bin:/bin", "BUN_ENABLE_CRASH_REPORTING": "0", "DO_NOT_TRACK": "1", "NO_COLOR": "1", "HOME": folder})
            if done.returncode != 0 or not done.stdout:
                raise NoProgram()
            return re.sub(r'(from "\./\w+)"', r'\1.js"', done.stdout.decode()).replace('.js.js"', '.js"').replace('"./main.ts"', '"./main.js"')
        finally:
            shutil.rmtree(folder, ignore_errors=True)


NUMBERS = ["0", "1", "-1", "2", "0.5", "-0", "255", "256", "65536", "2147483647", "2147483648", "-2147483648", "4294967295", "1e21", "1e-7", "9007199254740991", "3", "NaN", "Infinity", "-2147483649", "4294967296", "1073741824", "0.1", "-0.5", "9007199254740993", "1e308", "5e-324"]
GROUPS = [["+", "-", "*", "/", "%", "**"], ["<", "<=", ">", ">="], ["===", "!=="], ["&&", "||", "??"], ["&", "|", "^"], ["<<", ">>", ">>>"], ["+=", "-=", "*="]]
OPERATORS = {operator: group for group in GROUPS for operator in group}
OPERATOR = re.compile(r'(?<=[\w)\] ]) (\*\*|>>>|<<|>>|===|!==|<=|>=|&&|\|\||\?\?|\+=|-=|\*=|[-+*/%<>&|^]) (?=[\w(\[" ])')
NAME = re.compile(r'(?<![\w.$"\'`])[a-z_$][\w$]*(?![\w$"\'`:])')
STRINGS = ['""', '"a"', '"\\u4e16"', '"\\ud83d\\ude00"', '"\\ud83d"', '"ab".repeat(20)', '("x" + String(1))', '"abcdefgh".slice(2, 5)', '"\\u4e16abc".slice(1)', '"12"', '"-0"', '"__proto__"', '"constructor"', '"length"', '"\\0"', '"a".padEnd(300, "b")', 'String.fromCharCode(0x100)']


def code_lines(lines):
    return [i for i, line in enumerate(lines) if line.strip() and not line.lstrip().startswith("//")]


def mutate(text, rng):
    kind = rng.randrange(10)
    lines = text.split("\n")
    where = code_lines(lines)
    if not where:
        return text
    if kind == 0:
        found = list(re.finditer(r'(?<![\w.$"\'`])\d+(\.\d+)?(?![\w.])', text))
        if found:
            m = rng.choice(found)
            return text[: m.start()] + rng.choice(NUMBERS) + text[m.end():]
    if kind in (1, 2):
        found = list(OPERATOR.finditer(text))
        if found:
            m = rng.choice(found)
            return text[: m.start(1)] + rng.choice(OPERATORS[m.group(1)]) + text[m.end(1):]
    if kind == 3:
        names = list(NAME.finditer(text))
        if len(names) > 1:
            x, y = rng.choice(names), rng.choice(names)
            return text[: x.start()] + y.group(0) + text[x.end():]
    if kind == 4:
        del lines[rng.choice(where)]
        return "\n".join(lines)
    if kind == 5:
        i = rng.choice(where)
        lines.insert(i, lines[i])
        return "\n".join(lines)
    if kind == 6:
        found = list(re.finditer(r"\(([\w.$]+), ([\w.$]+)\)", text))
        if found:
            m = rng.choice(found)
            return text[: m.start()] + "(%s, %s)" % (m.group(2), m.group(1)) + text[m.end():]
    if kind == 7:
        found = list(re.finditer(r'"(?:[^"\\\n]|\\.)*"', text))
        if found:
            m = rng.choice(found)
            return text[: m.start()] + rng.choice(STRINGS) + text[m.end():]
    if kind == 8:
        found = list(re.finditer(r"\b(const|let) (\w+)(: [^=;\n]+)? = ", text))
        if found:
            m = rng.choice(found)
            return text[: m.start()] + "let %s%s = " % (m.group(2), m.group(3) or "") + text[m.end():] if m.group(1) == "const" else text[: m.start()] + "var %s%s = " % (m.group(2), m.group(3) or "") + text[m.end():]
    i, j = rng.choice(where), rng.choice(where)
    lines[i], lines[j] = lines[j], lines[i]
    return "\n".join(lines)


# What untyped code may do to an object that it was handed. `@` is a name in scope, `%` a property name seen in the program.
BORDER = [
    "Object.freeze(@);",
    "Object.seal(@);",
    "Object.preventExtensions(@);",
    "delete (@ as any).%;",
    "(@ as any).extraProperty = 1;",
    "(@ as any)[Symbol.for(\"extra\")] = 1;",
    "(@ as any)[0] = 1;",
    "Object.defineProperty(@, \"%\", { get() { return undefined; }, configurable: true, enumerable: true });",
    "Object.defineProperty(@, \"%\", { get() { throw new RangeError(\"getter\"); }, configurable: true });",
    "Object.defineProperty(@, \"%\", { value: (@ as any).%, writable: false, configurable: true, enumerable: true });",
    "Object.defineProperty(@, \"%\", { value: (@ as any).%, enumerable: false, writable: true, configurable: true });",
    "Object.setPrototypeOf(@, null);",
    "Object.setPrototypeOf(@, { %: \"inherited\" });",
    "Object.setPrototypeOf(@, new Proxy({}, { get(_, key) { return typeof key === \"string\" ? key.length : undefined; } }));",
    "Object.setPrototypeOf(@, Object.create(Object.getPrototypeOf(@)));",
    "{ const keptValue = (@ as any).%; delete (@ as any).%; (@ as any).% = keptValue; }",
    "for (let borderIndex = 0; borderIndex < 70; borderIndex++) (@ as any)[\"k\" + borderIndex] = borderIndex;",
    "Object.assign(@ as any, { % : (@ as any).% });",
    "(@ as any).% = (@ as any).%;",
    "Reflect.set(@ as any, \"%\", Reflect.get(@ as any, \"%\"));",
    "Reflect.deleteProperty(@ as any, \"%\");",
    "JSON.stringify(@);",
    "structuredClone(@);",
    "Object.keys(@ as any).forEach(borderKey => void (@ as any)[borderKey]);",
    "void Object.entries(@ as any);",
    "void { ...(@ as any) };",
    "(globalThis as any).keptValue = @;",
    "new WeakRef(@ as any);",
    "new WeakMap().set(@ as any, 1);",
    "try { (@ as any).%(); } catch {}",
    "try { new (@ as any)(); } catch {}",
    "try { (@ as any).%.call(null); } catch {}",
    "if (typeof Bun !== \"undefined\") Bun.gc(true);",
    "void String(@);",
    "void (@ as any == 1);",
    "void ((@ as any) + \"\");",
    "void (@ as any instanceof Object);",
]


def insert_border_statement(text, rng):
    lines = text.split("\n")
    where = code_lines(lines)
    declared = list(re.finditer(r"\b(?:const|let|var) (\w+)\b", text))
    properties = sorted(set(re.findall(r"\.([a-zA-Z_]\w*)\b(?!\()", text))) or ["x"]
    if not where or not declared:
        return text
    chosen = rng.choice(declared)
    line = text[: chosen.start()].count("\n")
    later = [i for i in where if i > line and lines[i].rstrip().endswith((";", "}")) and re.match(r"\s*(const|let|var|console|if|for|\w+[.(=\[ ])", lines[i])]
    if not later:
        return text
    at = rng.choice(later[:12])
    indent = re.match(r"\s*", lines[at]).group(0)
    statement = rng.choice(BORDER).replace("@", chosen.group(1)).replace("%", rng.choice(properties))
    lines.insert(at, indent + statement)
    return "\n".join(lines)


class Mutator:
    """Programs that print the same compiled and in plain Bun, changed a little. A mutant may hand a value to a type that it does not fit."""

    def __init__(self, tests, extension, farm, border=False):
        self.extension, self.farm, self.border = extension, farm, border
        self.name = ("border:" if border else "mutated:") + extension
        self.weight = 12.0 if not border else 8.0
        self.root = os.path.join(tests, "programs")
        self.programs = []
        for folder, _, names in sorted(os.walk(self.root)):
            if any(n.startswith("main.") for n in names):
                continue
            if any(os.path.exists(os.path.join(up, "main." + x)) for x in ("ts", "tsx", "js") for up in parents(folder, self.root)):
                continue
            for n in sorted(names):
                base = os.path.join(folder, n[: -len(extension) - 1])
                if n.endswith("." + extension) and not n.endswith(".d.ts") and not any(os.path.exists(base + e) for e in (".json", ".todo.txt", ".expected.txt", ".build-errors.txt")):
                    self.programs.append(os.path.join(folder, n))

    def seed_for(self, n):
        return n

    def make(self, seed):
        rng = random.Random(seed)
        path = rng.choice(self.programs)
        text = open(path, errors="replace").read()
        if len(text) > 60000 or re.search(r"^import .* from \"\.|require\(\"\.", text, flags=re.M):
            raise NoProgram()
        changed = text
        for _ in range(rng.choice((1, 1, 1, 2, 3))):
            changed = insert_border_statement(changed, rng) if self.border and rng.random() < 0.8 else mutate(changed, rng)
        if changed == text:
            raise NoProgram()
        main = "main." + self.extension
        return Program(self.name, seed, {main: changed}, main, may_be_refused=True, reference_may_fail=True, origin=os.path.relpath(path, self.root))


class Corpus:
    """The programs of test/aot/programs as they are, built where they lie."""

    def __init__(self, tests):
        self.name, self.weight = "corpus:programs", 12.0
        self.root = os.path.join(tests, "programs")
        self.programs = []

        def find(folder):
            entries = sorted(os.listdir(folder))
            main = next((e for e in entries if re.match(r"main\.(ts|tsx|js)$", e)), None)
            if main:
                return self.programs.append(os.path.join(folder, main))
            for e in entries:
                path = os.path.join(folder, e)
                if os.path.isdir(path):
                    find(path)
                elif re.search(r"\.(ts|tsx|js)$", e) and not e.endswith(".d.ts") and folder != self.root:
                    self.programs.append(path)

        find(self.root)
        self.count = len(self.programs)

    def seed_for(self, n):
        return n % self.count

    def make(self, seed):
        path = self.programs[seed]
        beside = re.sub(r"\.[a-z]+$", "", re.sub(r"/main\.[a-z]+$", "", path))
        if os.path.exists(beside + ".todo.txt") or os.path.exists(beside + ".build-errors.txt"):
            raise NoProgram()
        options = json.load(open(beside + ".json")) if os.path.exists(beside + ".json") else {}
        if options.get("reference") == "compiled":
            raise NoProgram()
        expected = open(beside + ".expected.txt").read() if os.path.exists(beside + ".expected.txt") else None
        env = options.get("env") or {}
        return Program(self.name, seed, {}, path, cwd=os.path.dirname(path), expected=expected, build_flags=options.get("build") or [], plain_env=env, run_env=env, origin=os.path.relpath(path, self.root))


def parents(folder, root):
    while len(folder) > len(root):
        yield folder
        folder = os.path.dirname(folder)


_cache = {}


def all_producers(tests, farm):
    folder = os.path.join(tests, "generated", "python")
    extra = os.path.join(os.path.dirname(os.path.abspath(__file__)), "generators")
    state = (tests, os.path.getmtime(os.path.join(tests, "generated", "python-generators.ts")), tuple(sorted(os.listdir(extra))) if os.path.isdir(extra) else ())
    if state in _cache:
        return _cache[state]
    found = []
    for line in open(os.path.join(tests, "generated", "python-generators.ts")):
        m = re.match(r'\s*\["([\w-]+)", "(ts|js)"(?:, (.*))?\],\s*$', line)
        if m and os.path.exists(os.path.join(folder, m.group(1) + ".py")):
            found.append(PythonGenerator(folder, m.group(1), m.group(2), m.group(3) or ""))
    if os.path.isdir(extra):
        for name in sorted(os.listdir(extra)):
            if name.endswith(".py"):
                head = open(os.path.join(extra, name)).read(400)
                g = PythonGenerator(extra, name[:-3], "js" if "LANGUAGE: js" in head else "ts", "orThrows" if "MAY BE REFUSED" in head else "")
                g.weight = 6.0
                found.append(g)
    found += [WithoutTypes(g, farm) for g in found if g.generator in ("typed-programs", "exception-paths", "typed-programs-in-workers", "resource-management", "control-flow", "calls-by-value", "objects", "strings", "maps-and-sets", "switch-statements", "tail-calls", "async-generators")]
    found += [Corpus(tests), Mutator(tests, "ts", farm), Mutator(tests, "js", farm), Mutator(tests, "ts", farm, border=True)]
    _cache[state] = found
    return found
