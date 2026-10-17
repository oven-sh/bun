#!/usr/bin/env python3
"""Makes a program smaller while a command keeps saying that it still shows what it showed.

    python3 reduce.py <program> <result> [-j <jobs>] [--seconds <limit>] -- <command> [words]

The command is run as `<command> [words] <candidate file>` in a folder of its own, and exits with 0 if the candidate is still interesting.
Whole blocks (from a line that opens braces to the line that closes them), runs of lines, and the first and last line of a block
(which leaves its body) are taken out, larger pieces first, until nothing more can go. Then parts of lines: arguments, operands, initializers.
"""
import concurrent.futures, os, re, shutil, subprocess, sys, tempfile, time

arguments = sys.argv[1:]
at = arguments.index("--")
command, arguments = arguments[at + 1:], arguments[:at]


def option(name, default):
    if name in arguments:
        i = arguments.index(name)
        value = arguments[i + 1]
        del arguments[i:i + 2]
        return value
    return default


jobs, seconds = int(option("-j", 8)), int(option("--seconds", 1500))
source, result = arguments[:2]
extension = os.path.splitext(source)[1]
work = tempfile.mkdtemp(prefix="reduce-", dir=os.environ.get("REDUCE_TMP"))
started, tests = time.time(), [0]


def interesting(lines):
    tests[0] += 1
    folder = tempfile.mkdtemp(dir=work)
    path = os.path.join(folder, "main" + extension)
    open(path, "w").write("\n".join(lines) + "\n")
    try:
        return subprocess.run(command + [path], cwd=folder, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600).returncode == 0
    except subprocess.TimeoutExpired:
        return False
    finally:
        shutil.rmtree(folder, ignore_errors=True)


def first_interesting(candidates):
    """The first of the candidates, in order, that is interesting. They are tried side by side."""
    with concurrent.futures.ThreadPoolExecutor(jobs) as pool:
        for start in range(0, len(candidates), jobs):
            if time.time() - started > seconds:
                return None
            batch = candidates[start:start + jobs]
            for candidate, good in zip(batch, pool.map(interesting, batch)):
                if good:
                    return candidate
    return None


def blocks(lines):
    """(first, last) of every run of lines whose braces, brackets and parentheses balance and that opens something in its first line."""
    found, stack = [], []
    for i, line in enumerate(lines):
        text = re.sub(r'"(?:[^"\\]|\\.)*"|\'(?:[^\'\\]|\\.)*\'|`(?:[^`\\]|\\.)*`|//.*', "", line)
        for c in text:
            if c in "{([":
                stack.append(i)
            elif c in "})]" and stack:
                first = stack.pop()
                if first != i:
                    found.append((first, i))
    return sorted(set(found), key=lambda b: b[0] - b[1])


def pass_over_blocks(lines):
    changed = False
    while True:
        candidates = []
        for first, last in blocks(lines):
            candidates.append(lines[:first] + lines[last + 1:])
        for first, last in blocks(lines):
            candidates.append(lines[:first] + lines[first + 1:last] + lines[last + 1:])
        got = first_interesting(candidates)
        if got is None:
            return lines, changed
        lines, changed = got, True


def pass_over_lines(lines):
    changed = False
    size = max(1, len(lines) // 2)
    while size >= 1:
        candidates = [lines[:i] + lines[i + size:] for i in range(0, len(lines), size)]
        got = first_interesting(candidates)
        if got is not None:
            lines, changed = got, True
        elif size == 1:
            break
        else:
            size //= 2
    return lines, changed


REWRITES = [
    (r"launder(?:Array)?<[^()]*?>\((\w+), \d+\)", r"\1"),
    (r"of<[^()]*?>\(([^()]*)\)", r"\1"),
    (r"\(([^()?:]+) \? ([^()?:]+) : ([^()?:]+)\)", r"\2"),
    (r"\(([^()?:]+) \? ([^()?:]+) : ([^()?:]+)\)", r"\3"),
    (r"\(([^()]+?) (?:[-+*/%|&^]|<<|>>>?|&&|\|\||\?\?) ([^()]+?)\)", r"\1"),
    (r"\(([^()]+?) (?:[-+*/%|&^]|<<|>>>?|&&|\|\||\?\?) ([^()]+?)\)", r"\2"),
    (r"\(([^()]+) as [\w |\[\]]+\)", r"\1"),
    (r"Math\.\w+\(([^(),]+)\)", r"\1"),
    (r"\(([\w.]+)\)", r"\1"),
    (r", [^,(){}\[\]]+(?=[)\]}])", ""),
    (r"(?<=[(\[{]) ?[^,(){}\[\]]+, ", ""),
    (r"\b(\w+)\??: [^;{}]+; ", ""),
]


def pass_over_expressions(lines):
    changed = False
    while True:
        candidates = []
        for i, line in enumerate(lines):
            for pattern, replacement in REWRITES:
                for m in re.finditer(pattern, line):
                    new = line[: m.start()] + m.expand(replacement) + line[m.end():]
                    if new != line:
                        candidates.append(lines[:i] + [new] + lines[i + 1:])
        got = first_interesting(candidates)
        if got is None:
            return lines, changed
        lines, changed = got, True


lines = open(source).read().split("\n")
if not interesting(lines):
    sys.exit("the program as it is does not show it")
while time.time() - started < seconds:
    lines, a = pass_over_blocks(lines)
    lines, b = pass_over_lines(lines)
    open(result, "w").write("\n".join(lines) + "\n")
    lines, c = pass_over_expressions(lines)
    open(result, "w").write("\n".join(lines) + "\n")
    print("%d lines, %d tests, %d s" % (len(lines), tests[0], time.time() - started), flush=True)
    if not (a or b or c):
        break
shutil.rmtree(work, ignore_errors=True)
