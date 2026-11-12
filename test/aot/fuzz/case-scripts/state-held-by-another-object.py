#!/usr/bin/env python3
"""state-held-by-another-object.py <folder>: State that lies on an object which is no operand of the call: two objects that
share it (a URL and its searchParams, an AbortController and a signal that is kept, a Response and its stream, views of one
buffer), or what is ambient (the working folder, the environment, the time zone, the files, the legacy members of RegExp,
the mapped arguments). The shape: read, act, read again, in one typed function. Where the description of a built-in misses
the link, the second read is merged with the first. A native call is not merged with another today, so only the cases
whose reads become loads can fail.
"""
import os, sys

out = sys.argv[1]
U = 'new URL("http://x/a?a=1")'
cases = []  # (name, extension, declarations, parameters, arguments, statements before, read, act)


def add(family, reads, acts, declarations="", parameters="", arguments="", before="", extension="ts"):
    for read_name, read in reads.items():
        for act_name, act in acts.items():
            cases.append((f"{family}.{read_name}.{act_name}", extension, declarations, parameters, arguments, before, read, act))


add("url-by-params", {"href": "u.href", "search": "u.search", "text": "String(u)", "json": "JSON.stringify(u)", "template": "`${u}`"},
    {"append": 'p.append("x", "1")', "set": 'p.set("a", "2")', "delete": 'p.delete("a")', "sort": 'p.append("0", "z"); p.sort()'},
    parameters="u: URL", arguments=U, before="const p = u.searchParams;")
add("url-by-params-apart", {"href": "u.href", "search": "u.search"}, {"append": 'p.append("x", "1")', "delete": 'p.delete("a")'},
    declarations=f"const kept = {U};\n", parameters="u: URL, p: URLSearchParams", arguments="kept, kept.searchParams")
add("params-by-url", {"get": 'p.get("a")', "size": "p.size", "text": "p.toString()", "has": 'p.has("b")', "spread": "[...p].length", "keys": "[...p.keys()].join()"},
    {"search": 'u.search = "?b=2&c=3"', "href": 'u.href = "http://y/?b=5"', "hash": 'u.hash = "#h"'},
    parameters="u: URL", arguments=U, before="const p = u.searchParams;")
add("url-parts", {"href": "u.href", "origin": "u.origin", "host": "u.host"}, {"port": 'u.port = "81"', "hostname": 'u.hostname = "y"', "protocol": 'u.protocol = "https:"', "pathname": 'u.pathname = "/b"'},
    parameters="u: URL", arguments=U)
add("signal-by-controller", {"aborted": "s.aborted", "reason": "typeof s.reason", "throws": '(() => { try { s.throwIfAborted(); return "no"; } catch { return "threw"; } })()'},
    {"abort": "c.abort()", "abort-reason": 'c.abort("r")'}, parameters="c: AbortController", arguments="new AbortController()", before="const s = c.signal;")
add("signal-any", {"aborted": "d.aborted"}, {"abort": "c.abort()"}, parameters="c: AbortController", arguments="new AbortController()", before="const d = AbortSignal.any([c.signal]);")
add("body-used", {"used": "r.bodyUsed"}, {"text": "void r.text()", "json": "void r.json().catch(() => {})", "reader": "r.body!.getReader()", "cancel": "void r.body!.cancel()", "blob": "void r.blob()", "bytes": "void r.bytes()"},
    parameters="r: Response", arguments='new Response("1")')
add("body-used-by-stream", {"used": "r.bodyUsed", "locked": "b.locked"}, {"reader": "b.getReader()", "read": "void b.getReader().read()", "cancel": "void b.cancel()", "tee": "b.tee()"},
    parameters="r: Response", arguments='new Response("1")', before="const b = r.body!;")
add("stream-locked-by-reader", {"locked": "s.locked"}, {"release": "reader.releaseLock()"}, parameters="s: ReadableStream", arguments="new ReadableStream()", before="const reader = s.getReader();")
add("headers-of-response", {"get": 'r.headers.get("a")', "has": 'r.headers.has("b")', "count": "[...r.headers].length"}, {"set": 'h.set("a", "2")', "append": 'h.append("b", "3")', "delete": 'h.delete("a")'},
    parameters="r: Response", arguments='new Response("", { headers: { a: "1" } })', before="const h = r.headers;")
add("view-by-buffer", {"length": "v.length", "bytes": "v.byteLength", "first": "v[0]", "offset": "v.byteOffset"}, {"resize": "b.resize(1)", "transfer": "b.transfer()", "grow": "b.resize(8)", "clone-transfer": "structuredClone(b, { transfer: [b] })"},
    parameters="b: ArrayBuffer", arguments="new ArrayBuffer(4, { maxByteLength: 8 })", before="const v = new Uint8Array(b); v[0] = 3;")
add("alias-views", {"first": "w[0]", "join": "w.join()", "float": "f[0]", "data": "d.getUint8(0)"},
    {"store": "v[0] = 9", "fill": "v.fill(7)", "set": "v.set([5])", "encode": 'new TextEncoder().encodeInto("z", v)', "data-set": "d.setUint8(0, 4)", "atomics": "Atomics.store(v, 0, 6)", "atomics-add": "Atomics.add(v, 0, 1)",
     "copy-within": "v[1] = 8; v.copyWithin(0, 1)", "reverse": "v[7] = 2; v.reverse()", "sort": "v.fill(3); v[7] = 1; v.sort()", "float-store": "f[0] = 1.5"},
    parameters="b: ArrayBuffer", arguments="new ArrayBuffer(8)", before="const v = new Uint8Array(b), w = new Uint8Array(b), f = new Float64Array(b), d = new DataView(b);")
add("alias-buffers", {"first": "s[0]", "text": "s.toString()", "read": "s.readUInt8(0)"},
    {"store": "b[0] = 65", "fill": 'b.fill("q")', "write": 'b.write("z")', "write-int": "b.writeUInt8(66, 0)", "copy": 'Buffer.from("y").copy(b)', "swap": "b[1] = 67; b.swap16()", "set": "b.set([68])"},
    parameters="b: Buffer", arguments='Buffer.from("abcd")', before="const s = b.subarray(0, 2);")
add("cwd", {"cwd": "process.cwd()", "resolve": 'path.resolve("x")', "exists": 'fs.existsSync("etc")', "stat": '(() => { try { return fs.statSync("etc").isDirectory(); } catch { return "none"; } })()', "file": 'Bun.file("etc/passwd").size > 0'},
    {"chdir": 'process.chdir("/")'}, declarations='import fs from "node:fs";\nimport path from "node:path";\nconst home = process.cwd();\n', parameters="n: number", arguments="1", before="process.chdir(home);")
add("env-alias", {"bun": "Bun.env.KEPT", "process": "process.env.KEPT", "meta": "import.meta.env.KEPT", "in": '"KEPT" in process.env', "keys": 'Object.keys(process.env).includes("KEPT")'},
    {"process": 'process.env.KEPT = "2"', "bun": 'Bun.env.KEPT = "3"', "delete": "delete process.env.KEPT", "assign": 'Object.assign(process.env, { KEPT: "4" })', "reflect": 'Reflect.set(process.env, "KEPT", "5")'},
    parameters="n: number", arguments="1", before='process.env.KEPT = "1";')
add("time-zone", {"hours": "d.getHours()", "text": "d.toString()", "offset": "d.getTimezoneOffset()", "local": "new Date(2020, 0, 1).getTime()", "locale": 'd.toLocaleTimeString("en-US")', "zone": "Intl.DateTimeFormat().resolvedOptions().timeZone", "day": "d.getDate()", "parse": 'Date.parse("2020-01-01T00:00:00")'},
    {"tokyo": 'process.env.TZ = "Asia/Tokyo"'}, parameters="d: Date", arguments="new Date(0)", before='process.env.TZ = "America/New_York";')
add("which-by-path", {"which": 'Bun.which("ls") !== null'}, {"path": 'process.env.PATH = "/nonexistent"'}, declarations="const paths = process.env.PATH;\n", parameters="n: number", arguments="1", before="process.env.PATH = paths;")
F = 'import fs from "node:fs";\nimport os from "node:os";\nimport path from "node:path";\nconst folder = fs.mkdtempSync(path.join(os.tmpdir(), "linked-"));\nprocess.on("exit", () => fs.rmSync(folder, { recursive: true, force: true }));\nlet turnOf = 0;\n'
add("files", {"exists": "fs.existsSync(p)", "size": '(() => { try { return fs.statSync(p).size; } catch { return "none"; } })()', "text": '(() => { try { return fs.readFileSync(p, "utf8"); } catch { return "none"; } })()', "list": "fs.readdirSync(folder).length",
              "bun-size": "Bun.file(p).size", "access": '(() => { try { fs.accessSync(p); return "yes"; } catch { return "no"; } })()', "lstat": "fs.lstatSync(p, { throwIfNoEntry: false })?.size"},
    {"write": 'fs.writeFileSync(p, "xy")', "append": 'fs.appendFileSync(p, "z")', "open": 'fs.closeSync(fs.openSync(p, "w"))', "copy": 'fs.writeFileSync(p + "0", "abc"); fs.copyFileSync(p + "0", p)', "rename": 'fs.writeFileSync(p + "1", "ab"); fs.renameSync(p + "1", p)', "mkdir": "fs.mkdirSync(p)"},
    declarations=F, parameters="p: string", arguments='path.join(folder, "f" + turnOf++)')
add("files-gone", {"exists": "fs.existsSync(p)", "list": "fs.readdirSync(folder).length"}, {"unlink": "fs.unlinkSync(p)", "rm": "fs.rmSync(p)", "truncate-size": "fs.truncateSync(p, 0)"},
    declarations=F, parameters="p: string", arguments='path.join(folder, "f" + turnOf++)', before='fs.writeFileSync(p, "xy");')
add("files-descriptor", {"read": 'fs.readSync(fd, one, 0, 1, null) + ":" + one[0]', "stat": "fs.fstatSync(fd).size"}, {"nothing": "", "write": 'fs.appendFileSync(p, "q")'},
    declarations=F, parameters="p: string", arguments='path.join(folder, "f" + turnOf++)', before='fs.writeFileSync(p, "ab"); const fd = fs.openSync(p, "r"); const one = new Uint8Array(1);')
R = {"one": "RegExp.$1", "last": "RegExp.lastMatch", "left": "RegExp.leftContext", "right": "RegExp.rightContext", "input": "RegExp.input", "paren": "RegExp.lastParen", "amp": '(RegExp as any)["$&"]'}
add("regexp-legacy", R, {"test": "/(b)/.test(s)", "exec": "/(b)/.exec(s)", "match": "s.match(/(b)/)", "replace": 's.replace(/(b)/, "x")', "split": "s.split(/(b)/)", "search": "s.search(/(b)/)", "match-all": "[...s.matchAll(/(b)/g)]", "replace-all": 's.replaceAll(/(b)/g, "x")', "kept": "kept.test(s)"},
    declarations="const kept = /(b)/;\n", parameters="s: string", arguments='"abc"', before='/(z)/.test("yzw");')
add("last-index", {"index": "r.lastIndex"}, {"match": "s.match(r)", "replace": 's.replace(r, "x")', "test": "r.test(s)", "exec": "r.exec(s)", "match-all": "[...s.matchAll(r)]", "search": "s.search(r)", "split": "s.split(r)", "replace-all": 's.replaceAll(r, "x")'},
    parameters="r: RegExp, s: string", arguments='/b/g, "abcb"', before="r.lastIndex = 1;")
add("last-index-sticky", {"index": "r.lastIndex"}, {"match": "s.match(r)", "replace": 's.replace(r, "x")', "test": "r.test(s)", "search": "s.search(r)", "split": "s.split(r)"},
    parameters="r: RegExp, s: string", arguments='/b/y, "abcb"', before="r.lastIndex = 1;")
add("marks", {"count": 'performance.getEntriesByName("m").length', "all": 'performance.getEntriesByType("mark").length'}, {"mark": 'performance.mark("m")', "clear": 'performance.mark("m"); performance.clearMarks("m")'}, parameters="n: number", arguments="1")
add("global", {"bare": "typeof kept === \"undefined\" ? \"none\" : kept", "member": "(globalThis as any).kept", "in": '"kept" in globalThis'},
    {"store": "(globalThis as any).kept = 2", "computed": '(globalThis as any)["ke" + "pt"] = 3', "define": 'Object.defineProperty(globalThis, "kept", { value: 4, writable: true, configurable: true })', "delete": "delete (globalThis as any).kept", "reflect": 'Reflect.set(globalThis, "kept", 5)', "assign": "Object.assign(globalThis, { kept: 6 })"},
    declarations="declare var kept: number;\n", parameters="n: number", arguments="1", before="(globalThis as any).kept = 1;")
add("ports", {"receive": "receiveMessageOnPort(c.port2)?.message"}, {"post": "c.port1.postMessage(1)", "nothing": ""}, declarations='import { receiveMessageOnPort } from "node:worker_threads";\n', parameters="c: MessageChannel", arguments="new MessageChannel()")
add("collection-by-iterator", {"next": "String(it.next().value)"}, {"set": 'm.set("c", 3)', "delete": 'm.delete("b")', "clear": "m.clear()", "nothing": ""}, parameters="m: Map<string, number>", arguments='new Map([["a", 1], ["b", 2]])', before="const it = m.keys();")
add("list-by-iterator", {"next": "String(it.next().value)"}, {"push": "a.push(9)", "shorten": "a.length = 1", "store": "a[1] = 7", "nothing": ""}, parameters="a: number[]", arguments="[1, 2]", before="const it = a.values();")
add("timer", {"ref": "t.hasRef()"}, {"unref": "t.unref()", "clear": "clearTimeout(t)"}, parameters="n: number", arguments="1", before="const t = setTimeout(() => {}, 1); queueMicrotask(() => clearTimeout(t));")
add("exit-code", {"code": "process.exitCode"}, {"store": "process.exitCode = 0"}, parameters="n: number", arguments="1")
add("title", {"title": "process.title.length > 0"}, {"store": 'process.title = "t"'}, parameters="n: number", arguments="1")
add("symbol-registry", {"key": "Symbol.keyFor(s)"}, {"for": 'Symbol.for("other")'}, parameters="s: symbol", arguments='Symbol.for("k")')

# Not read, act, read: each is a whole body that answers a primitive.
whole = {
    "limit.around-new": ("ts", 'function look(m: string): number { Error.stackTraceLimit = 0; const e = new Error(m); Error.stackTraceLimit = 10; return e.stack!.split("\\n").length; }'),
    "limit.around-own-class": ("ts", 'class F extends Error { code = 7; }\nfunction look(m: string): number { Error.stackTraceLimit = 0; const e = new F(m); Error.stackTraceLimit = 10; return e.stack!.split("\\n").length; }'),
    "limit.kept-and-restored": ("ts", 'function look(m: string): number { const old = Error.stackTraceLimit; Error.stackTraceLimit = 0; const e = new Error(m); Error.stackTraceLimit = old; return e.stack!.split("\\n").length; }'),
    "limit.around-capture": ("ts", 'function look(m: string): number { const o: { stack?: string } = {}; Error.stackTraceLimit = 0; Error.captureStackTrace(o); Error.stackTraceLimit = 10; return o.stack!.split("\\n").length; }'),
    "limit.around-native-throw": ("ts", 'function look(m: string): number { Error.stackTraceLimit = 0; let e: any; try { JSON.parse(m); } catch (caught) { e = caught; } Error.stackTraceLimit = 10; return e.stack.split("\\n").length; }'),
    "limit.around-null-read": ("ts", 'function look(m: string): number { const none: any = null; Error.stackTraceLimit = 0; let e: any; try { none.x; } catch (caught) { e = caught; } Error.stackTraceLimit = 10; return e.stack.split("\\n").length; }'),
    "limit.one-then-many": ("ts", 'function deep(m: string, n: number): Error { return n ? deep(m, n - 1) : new Error(m); }\nfunction look(m: string): string { Error.stackTraceLimit = 1; const a = deep(m, 4); Error.stackTraceLimit = 3; const b = deep(m, 4); Error.stackTraceLimit = 10; return a.stack!.split("\\n").length + " " + b.stack!.split("\\n").length; }'),
    "time.now-moves": ("ts", 'function look(m: string): boolean { const start = Date.now(); let spins = 0; while (Date.now() - start < 3) spins++; return spins > 0; }'),
    "time.performance-moves": ("ts", 'function look(m: string): boolean { const a = performance.now(); const start = Date.now(); while (Date.now() - start < 2); return performance.now() > a; }'),
    "time.nanoseconds-move": ("ts", 'function look(m: string): boolean { const a = Bun.nanoseconds(); let x = 0; for (let i = 0; i < 1000; i++) x += i; return Bun.nanoseconds() > a && x > 0; }'),
    "time.hrtime-moves": ("ts", 'function look(m: string): boolean { const a = process.hrtime.bigint(); let x = 0; for (let i = 0; i < 1000; i++) x += i; return process.hrtime.bigint() > a && x > 0; }'),
    "time.new-date-moves": ("ts", 'function look(m: string): boolean { const a = new Date().getTime(); const start = performance.now(); while (performance.now() - start < 3); return new Date().getTime() > a; }'),
    "fresh.random": ("ts", "function look(m: string): boolean { return Math.random() === Math.random(); }"),
    "fresh.uuid": ("ts", "function look(m: string): boolean { return crypto.randomUUID() === crypto.randomUUID(); }"),
    "fresh.symbol": ("ts", "function look(m: string): boolean { return Symbol(m) === Symbol(m); }"),
    "fresh.random-values": ("ts", "function look(m: string): boolean { const a = crypto.getRandomValues(new Uint32Array(4)).join(); const b = crypto.getRandomValues(new Uint32Array(4)).join(); return a === b; }"),
    "fresh.random-bytes": ("ts", 'import { randomBytes, randomInt } from "node:crypto";\nfunction look(m: string): boolean { return randomBytes(8).toString("hex") === randomBytes(8).toString("hex") && randomInt(1 << 30) === randomInt(1 << 30); }'),
    "fresh.objects": ("ts", "function look(m: string): string { const same = (a: unknown, b: unknown) => a === b; return same(new Date(0), new Date(0)) + \" \" + same(new URL(\"http://x\"), new URL(\"http://x\")) + \" \" + same(new Map(), new Map()) + \" \" + same(Buffer.alloc(1), Buffer.alloc(1)) + \" \" + same(/a/, /a/); }"),
    "order.writers": ("ts", 'import fs from "node:fs";\nfunction look(m: string): number { console.log("a" + m); process.stdout.write("b" + m + "\\n"); console.log("c" + m); fs.writeSync(1, "d" + m + "\\n"); console.log("e" + m); return 1; }'),
    "arguments.store": ("cjs", 'function look(a) { const first = a; arguments[0] = 2; return first + " " + a; }'),
    "arguments.parameter-store": ("cjs", 'function look(a) { const first = arguments[0]; a = 2; return first + " " + arguments[0]; }'),
    "arguments.fill": ("cjs", 'function look(a) { const first = a; Array.prototype.fill.call(arguments, 9); return first + " " + a; }'),
    "arguments.assign": ("cjs", 'function look(a) { const first = a; Object.assign(arguments, [7]); return first + " " + a; }'),
    "arguments.reflect-set": ("cjs", 'function look(a) { const first = a; Reflect.set(arguments, 0, 5); return first + " " + a; }'),
    "arguments.reverse": ("cjs", 'function look(a, b) { const first = a; Array.prototype.reverse.call(arguments); return first + " " + a + " " + b; }'),
    "arguments.sort": ("cjs", 'function look(a, b) { const first = a; Array.prototype.sort.call(arguments); return first + " " + a + " " + b; }'),
    "arguments.copy-within": ("cjs", 'function look(a, b) { const first = a; Array.prototype.copyWithin.call(arguments, 0, 1); return first + " " + a + " " + b; }'),
    "arguments.define": ("cjs", 'function look(a) { const first = a; Object.defineProperty(arguments, "0", { value: 4 }); return first + " " + a; }'),
    "arguments.splice": ("cjs", 'function look(a, b) { const first = a; Array.prototype.splice.call(arguments, 0, 1); return first + " " + a + " " + b; }'),
    "arguments.escapes": ("cjs", 'function change(list) { list[0] = 6; }\nfunction look(a) { const first = a; change(arguments); return first + " " + a; }'),
    "arguments.delete": ("cjs", 'function look(a) { delete arguments[0]; arguments[0] = 3; return a + " " + arguments[0]; }'),
    "arguments.freeze": ("cjs", 'function look(a) { Object.freeze(arguments); a = 2; return a + " " + arguments[0]; }'),
}

made = 0
for name, extension, declarations, parameters, arguments, before, read, act in cases:
    text = declarations + f'function look({parameters}): string {{ {before} const first = {read}; {act}; const second = {read}; return first + " | " + second; }}\nfor (let turn = 0; turn < 3; turn++) console.log(look({arguments}));\n'
    folder = os.path.join(out, name); os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, "main." + extension), "w").write(text); made += 1
for name, (extension, text) in whole.items():
    call = 'look("z", "y")' if extension == "cjs" else 'look("{")'
    folder = os.path.join(out, name); os.makedirs(folder, exist_ok=True)
    open(os.path.join(folder, "main." + extension), "w").write(text + f"\nfor (let turn = 0; turn < 3; turn++) console.log({call});\n"); made += 1
print(made, "programs:", len(cases), "of the shape read, act, read;", len(whole), "whole bodies")
