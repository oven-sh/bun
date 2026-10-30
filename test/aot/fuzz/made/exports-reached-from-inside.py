#!/usr/bin/env python3
"""exports-reached-from-inside.py <folder>: ONE CASE A FOLDER: the namespace object of lib.ts is FOLLOWED (only read by written names), so what nobody reads is cleared: and then what was cleared is reached from INSIDE the library by roads that are no read in the IR: a direct eval of a name, `this` of a method call seen by an eval or an arrow, a getter, a label kept in a closure.
And: initializers with effects of exported variables that nothing reads: what made the value must still happen, in order."""
import os, sys
out = sys.argv[1]
cases = {}
def case(name, files): cases[name] = files

BODY = '''let hook: () => string = () => "the first hook";
export function setHook(next: () => string): void { hook = next; }
export function callHook(): string { return hook(); }
export function hidden(): string { return "hidden was reached"; }
export const hiddenArrow = (): string => "hiddenArrow was reached";
export const hiddenTable: { a: number; b: string } = { a: 1, b: "two" };
export class HiddenClass { value = 5; method(): string { return "HiddenClass.method was reached " + this.value; } }
export let unseenCount = 7;
export function unrelated(): string { return "unrelated"; }
'''
for how, get in (("dynamic", 'const ns = await import("./lib.ts");\n'), ("static", 'import * as ns from "./lib.ts";\n'), ("required", 'const ns = require("./lib.ts") as typeof import("./lib.ts");\n'), ("then", None)):
    def main(body):
        if get is None: return 'await import("./lib.ts").then(ns => {\n' + body + '});\n'
        return get + body
    PEEK = BODY + 'export function peek(code: string): unknown { return eval(code); }\n'
    for label, code in (("a-table", '"JSON.stringify(hiddenTable)"'), ("a-function", '"hidden()"'), ("an-arrow", '"hiddenArrow()"'), ("a-class", '"new HiddenClass().method()"'), ("a-count", '"unseenCount"'), ("typeof-all", '"[typeof hidden, typeof hiddenArrow, typeof hiddenTable, typeof HiddenClass, typeof unseenCount, typeof setHook].join()"')):
        case(f"{how}-the-library-evals-the-name-of-{label}", {"lib.ts": PEEK, "main.ts": main(f'console.log(ns.unrelated()); console.log(String(ns.peek({code})));\n')})
    case(f"{how}-the-library-evals-the-setter", {"lib.ts": PEEK, "main.ts": main('console.log(ns.unrelated(), ns.callHook()); (ns.peek("setHook") as (f: () => string) => void)(() => "the second hook"); console.log(ns.callHook());\n')})
    case(f"{how}-the-library-evals-a-store-to-the-hook", {"lib.ts": PEEK, "main.ts": main('console.log(ns.unrelated(), ns.callHook()); ns.peek("hook = () => \'the second hook\'"); console.log(ns.callHook());\n')})
    case(f"{how}-a-method-whose-eval-reads-this", {"lib.ts": BODY + 'export function self(): any { return eval("this"); }\n', "main.ts": main('console.log(ns.unrelated()); const got = ns.self(); console.log(typeof got); if (got) { console.log(got[["hid", "den"].join("")]()); got[["set", "Hook"].join("")](() => "the second hook"); } console.log(ns.callHook());\n')})
    case(f"{how}-a-method-whose-arrow-reads-this", {"lib.ts": BODY + 'export function self(this: any): any { return (() => this)(); }\n', "main.ts": main('console.log(ns.unrelated()); const got = ns.self(); console.log(typeof got); if (got) { console.log(got[["hid", "den"].join("")]()); got[["set", "Hook"].join("")](() => "the second hook"); } console.log(ns.callHook());\n')})
    case(f"{how}-a-method-whose-nested-arrows-eval-reads-this", {"lib.ts": BODY + 'export function self(): any { return (() => (() => eval("this"))())(); }\n', "main.ts": main('console.log(ns.unrelated()); const got = ns.self(); console.log(typeof got); if (got) { console.log(got[["hid", "den"].join("")]()); got[["set", "Hook"].join("")](() => "the second hook"); } console.log(ns.callHook());\n')})
    case(f"{how}-a-method-with-a-default-parameter-that-reads-this", {"lib.ts": BODY + 'export function self(this: any, got: any = this): any { return got; }\n', "main.ts": main('console.log(ns.unrelated()); const got = ns.self(); console.log(typeof got); if (got) { console.log(got[["hid", "den"].join("")]()); got[["set", "Hook"].join("")](() => "the second hook"); } console.log(ns.callHook());\n')})
    case(f"{how}-an-async-method-that-reads-this", {"lib.ts": BODY + 'export async function self(this: any): Promise<any> { return [this]; }\n', "main.ts": (main('console.log(ns.unrelated()); return ns.self().then(([got]: any[]) => { console.log(typeof got); if (got) { console.log(got[["hid", "den"].join("")]()); got[["set", "Hook"].join("")](() => "the second hook"); } console.log(ns.callHook()); });\n') if get is None else main('console.log(ns.unrelated()); const [got] = await ns.self(); console.log(typeof got); if (got) { console.log(got[["hid", "den"].join("")]()); got[["set", "Hook"].join("")](() => "the second hook"); } console.log(ns.callHook());\n'))})
    case(f"{how}-a-generator-method-that-reads-this", {"lib.ts": BODY + 'export function* self(this: any): Generator<any> { yield this; }\n', "main.ts": main('console.log(ns.unrelated()); const [got] = [...ns.self()]; console.log(typeof got); if (got) { console.log(got[["hid", "den"].join("")]()); got[["set", "Hook"].join("")](() => "the second hook"); } console.log(ns.callHook());\n')})
    case(f"{how}-a-class-called-as-a-member-with-new", {"lib.ts": BODY + 'export class Keeps { static self(this: any): any { return this; } }\n', "main.ts": main('console.log(ns.unrelated()); console.log(ns.Keeps.self() === ns.Keeps, new ns.Keeps() instanceof ns.Keeps);\n')})
    # the reads the language itself makes
    case(f"{how}-template-and-string-of-the-object", {"lib.ts": BODY, "main.ts": main('console.log(ns.unrelated()); try { console.log(`${ns as any}`); } catch (e) { console.log((e as Error).name); } console.log(Object.prototype.toString.call(ns));\n')})
    case(f"{how}-compared-loosely", {"lib.ts": BODY, "main.ts": main('console.log(ns.unrelated()); try { console.log((ns as any) == "x"); } catch (e) { console.log((e as Error).name); }\n')})
    case(f"{how}-json-of-the-object", {"lib.ts": BODY, "main.ts": main('console.log(ns.unrelated()); console.log(JSON.stringify(ns));\n')})

# exported variables that nothing reads: what their initializers DO must still be done, in order
EFFECTS = [
    ("a-call", 'say("called")'), ("a-new", 'new Loud("made")'), ("a-getter-read", 'loud.got'), ("a-computed-key", '{ [say("key")]: 1 }'), ("a-spread-of-a-proxy", '{ ...trapped }'), ("a-spread-of-a-generator", '[...counting()]'),
    ("a-template", '`${speaks}`'), ("an-addition", '(speaks as any) + 1'), ("a-tagged-template", 'tag`x${1}`'), ("an-array-of-calls", '[say("one"), say("two")]'), ("an-object-of-calls", '{ a: say("a"), b: say("b") }'),
    ("a-class-with-a-static-block", 'class { static { say("static block"); } }'), ("a-class-with-a-static-field", 'class { static f = say("static field"); }'), ("a-class-with-a-computed-method", 'class { [say("method key")]() {} }'), ("a-class-that-extends-a-call", 'class extends (say("heritage"), Object) {}'),
    ("an-in", '"x" in trapped'), ("an-instanceof", '({}) instanceof (Picky as any)'), ("a-delete", 'delete (trapped as any).x'), ("a-comma", '(say("left"), 5)'), ("a-conditional", 'say("test") ? say("yes") : say("no")'), ("a-nullish", 'undefinedNow ?? say("fallback")'),
    ("an-await", 'await later("awaited")'), ("an-assignment", '(other = say("assigned"))'), ("an-update", 'counter++'), ("an-optional-call", 'maybe?.(say("argument"))'), ("a-destructuring-source", '(({ got }) => got)(loud)'), ("a-throwing-read", 'guarded(() => (undefinedNow as any).x)'),
    ("a-regexp-exec", '/a/.exec(speaks as any)'), ("a-symbol-description", 'Symbol(speaks as any)'), ("a-bigint-of", 'guarded(() => BigInt(speaks as any))'), ("json-stringify", 'JSON.stringify(loud)'), ("object-keys-of-a-proxy", 'Object.keys(trapped)'), ("array-from", 'Array.from(counting())'), ("a-map-of-an-iterable", 'new Map(pairs())'),
    ("a-frozen-literal", 'Object.freeze({ a: say("frozen") })'), ("a-bound-function", 'say.bind(null, "never called")'), ("a-function-with-a-default", '((x = say("default")) => x)()'), ("a-label-of-typeof", 'typeof say("operand")'), ("a-void", 'void say("voided")'), ("a-negation", '-(speaks as any)'),
]
HELP = '''export const log: string[] = [];
export function say(word: string): string { log.push(word); return word; }
export class Loud { constructor(word: string) { say("constructed " + word); } }
export const loud = { get got(): string { return say("getter"); }, toJSON(): string { return say("toJSON"); } };
export const trapped: Record<string, unknown> = new Proxy({ x: 1 } as Record<string, unknown>, { ownKeys(t) { say("ownKeys"); return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { say("descriptor " + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k) { say("get " + String(k)); return Reflect.get(t, k); }, has(t, k) { say("has " + String(k)); return Reflect.has(t, k); }, deleteProperty(t, k) { say("delete " + String(k)); return true; } });
export function* counting(): Generator<number> { say("first"); yield 1; say("second"); yield 2; say("end"); }
export function* pairs(): Generator<[number, number]> { say("pair"); yield [1, 2]; say("pairs end"); }
export const speaks = { toString(): string { return say("toString"); }, valueOf(): number { say("valueOf"); return 3; }, [Symbol.toPrimitive](hint: string): string { return say("toPrimitive " + hint); } };
export function tag(strings: TemplateStringsArray, ...values: unknown[]): string { return say("tag " + strings.join("|") + values.join()); }
export const Picky = { [Symbol.hasInstance](): boolean { say("hasInstance"); return false; } };
export const undefinedNow: string | undefined = [undefined][0];
export function later(word: string): Promise<string> { return Promise.resolve().then(() => say(word)); }
export const maybe: ((x: string) => string) | undefined = [say][0];
export function guarded(f: () => unknown): unknown { try { return f(); } catch (e) { return say("caught " + (e as Error).name); } }
'''
for label, text in EFFECTS:
    lib = 'import { say, Loud, loud, trapped, counting, pairs, speaks, tag, Picky, undefinedNow, later, maybe, guarded } from "./help.ts";\nlet other: unknown; let counter = 0;\nsay("before");\nexport const nobodyReadsThis = ' + text + ';\nsay("after");\nexport function state(): string { return String(other) + counter; }\nexport function unrelated(): string { return "unrelated"; }\n'
    case(f"effects-of-{label}", {"help.ts": HELP, "lib.ts": lib, "main.ts": 'import { log } from "./help.ts";\nconst ns = await import("./lib.ts"); console.log(ns.unrelated(), ns.state()); console.log(log.join(" . "));\n'})
    lib2 = lib.replace("export const nobodyReadsThis = ", "export let nobodyReadsThis: unknown = 0;\nnobodyReadsThis = ")
    case(f"effects-of-{label}-stored-later", {"help.ts": HELP, "lib.ts": lib2, "main.ts": 'import { log } from "./help.ts";\nconst ns = await import("./lib.ts"); console.log(ns.unrelated(), ns.state()); console.log(log.join(" . "));\n'})

for name, files in cases.items():
    os.makedirs(f"{out}/{name}", exist_ok=True)
    for f, text in files.items():
        open(f"{out}/{name}/{f}", "w").write(text)
print(len(cases), "cases")
