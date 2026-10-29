#!/usr/bin/env python3
"""flows.py: a formatter made from constants that travels (exported, captured, in fields, passed to untyped code), everything else a formatter can be asked, options kept in module constants that are changed in ways a compiler may miss,
variables read before they are initialized or reassigned in unusual ways, and Intl itself shadowed or replaced. Each scene runs once on constants and once on a twin whose arguments are opaque; transcripts must be equal."""
import sys, os, json, re
D = ('"en-US"', '{ dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" }'); N = ('"de"', '{ minimumFractionDigits: 2 }')
def make(kind, constant):
    l, o = D if kind == "date" else N; c = "DateTimeFormat" if kind == "date" else "NumberFormat"
    return "new Intl.%s(%s, %s)" % (c, l, o) if constant else "new Intl.%s(hide(%s), hide(%s))" % (c, l, o)
# MAKE = the construction, V / W = values
SCENES = [
 ("resolvedOptions", "return JSON.stringify(MAKE.resolvedOptions());"),
 ("resolvedOptions after format", "const f = MAKE; f.format(V); return JSON.stringify(f.resolvedOptions());"),
 ("formatToParts", "return JSON.stringify(MAKE.formatToParts(V));"),
 ("formatToParts then format", "const f = MAKE; const p = f.formatToParts(V).map(x => x.value).join(''); return p + '|' + f.format(V) + '|' + (p === f.format(V));"),
 ("formatRange", "return attempt(() => MAKE.formatRange(W, V));"),
 ("formatRangeToParts", "return attempt(() => JSON.stringify(MAKE.formatRangeToParts(W, V)));"),
 ("what kind of object", "const f = MAKE; return [Object.prototype.toString.call(f), typeof f, f instanceof Intl.DateTimeFormat, f instanceof Intl.NumberFormat, f.constructor.name, Object.getPrototypeOf(f) === f.constructor.prototype, Object.keys(f).length, Reflect.ownKeys(f).length, JSON.stringify(f), Object.isExtensible(f), String(f)].join();"),
 ("inspect", "return Bun.inspect(MAKE);"),
 ("structuredClone", "return attempt(() => typeof structuredClone(MAKE));"),
 ("the getter is cached", "const f = MAKE; return [f.format === f.format, f.format.name, f.format.length, typeof f.format, Object.getPrototypeOf(f.format) === Function.prototype, 'prototype' in f.format].join();"),
 ("two formatters, two bound functions", "const f = MAKE, g = MAKE; return [f === g, f.format === g.format, f.format(V) === g.format(V)].join();"),
 ("new on the bound function", "const f = MAKE; return attempt(() => new f.format(V));"),
 ("captured by a closure", "const f = MAKE; const g = () => f.format(V); return g() + g();"),
 ("returned by a function", "const build = () => MAKE; return build().format(V);"),
 ("in an object field", "const o = { f: MAKE }; return o.f.format(V);"),
 ("in a class field", "class C { f = MAKE; show(v) { return this.f.format(v); } } return new C().show(V);"),
 ("in a private field", "class C { #f = MAKE; show(v) { return this.#f.format(v); } } return new C().show(V);"),
 ("in a static field", "class C { static f = MAKE; } return C.f.format(V);"),
 ("in an array and a Map", "const a = [MAKE]; const m = new Map([['k', a[0]]]); return a[0].format(V) + m.get('k').format(W);"),
 ("as a default parameter", "const show = (v, f = MAKE) => f.format(v); return show(V) + show(W);"),
 ("destructured", "const { f } = { f: MAKE }; const [g] = [f]; return g.format(V);"),
 ("through a conditional", "const f = hide(true) ? MAKE : OTHER; return f.format(V);"),
 ("through a conditional, the other arm", "const f = hide(false) ? MAKE : OTHER; return f.format(V);"),
 ("through ?? and ||", "const f = hide(null) ?? MAKE; const g = hide(0) || MAKE; return f.format(V) + g.format(W);"),
 ("lazily made", "let f; const get = () => (f ??= MAKE); return get().format(V) + get().format(W) + (get() === get());"),
 ("passed to untyped code", "return formatIn(MAKE, V);"),
 ("altered by untyped code", "const f = MAKE; giveOwnFormat(f); return f.format(V);"),
 ("prototype changed by untyped code", "const f = MAKE; changePrototype(f); return attempt(() => f.format(V));"),
 ("kept by untyped code and used later", "keep(MAKE); return useKept(V);"),
 ("in a generator and an async function", "function* g() { const f = MAKE; yield f.format(V); yield f.format(W); } return [...g()].join();"),
 ("made in a loop", "let s = ''; for (let i = 0; i < 5; i++) s += MAKE.format(V + i); return s;"),
 ("made in a loop and kept", "const all = []; for (let i = 0; i < 5; i++) all.push(MAKE); all[2].extra = 1; Object.defineProperty(all[3], 'format', { value: () => 'own' }); return all.map(f => f.format(V)).join('|') + new Set(all).size;"),
 ("after a collection", "const f = MAKE; Bun.gc(true); const a = f.format(V); Bun.gc(true); return a + f.format(W) + JSON.stringify(f.resolvedOptions()).length;"),
 ("WeakRef and WeakMap", "const f = MAKE; const w = new WeakRef(f), m = new WeakMap([[f, 1]]); return w.deref().format(V) + m.get(f);"),
 ("Reflect.apply and call of the getter", "const f = MAKE; const get = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f), 'format').get; return Reflect.apply(get, f, [])(V) + get.call(f)(W);"),
 ("the getter on something else", "const f = MAKE; const get = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(f), 'format').get; return [attempt(() => get.call({})), attempt(() => get.call(Object.create(f))), attempt(() => get.call(undefined))].join();"),
 ("an object that inherits from the formatter", "const o = Object.create(MAKE); return attempt(() => o.format(V));"),
 ("a Proxy of the formatter", "const p = new Proxy(MAKE, {}); return attempt(() => p.format(V));"),
 ("called without new", "return attempt(() => MAKE_WITHOUT_NEW.format(V));"),
 ("Reflect.construct", "return Reflect.construct(CLASS, ARGS).format(V);"),
 ("Reflect.construct with another new.target", "class Mine extends CLASS { format2(v) { return 'mine ' + this.format(v); } } return Reflect.construct(CLASS, ARGS, Mine).format2(V);"),
 ("a subclass", "class Mine extends CLASS { get format() { return () => 'subclass'; } } return new Mine(...ARGS).format(V);"),
 ("a subclass that adds nothing", "class Mine extends CLASS {} const f = new Mine(...ARGS); return f.format(V) + (f instanceof Mine);"),
 ("three arguments", "return MAKE3.format(V);"),
 ("sealed, frozen, not extensible", "const f = MAKE; Object.preventExtensions(f); const a = f.format(V); Object.seal(f); const b = f.format(V); Object.freeze(f); return a + b + f.format(V);"),
 ("a symbol property", "const f = MAKE; f[Symbol.toStringTag] = 'Mine'; return f.format(V) + Object.prototype.toString.call(f);"),
 ("an index property", "const f = MAKE; f[0] = 1; return f.format(V) + f[0];"),
 ("supportedLocalesOf and friends stay", "return [CLASS.supportedLocalesOf(['de', 'xx']).join(), CLASS.name, CLASS.length, typeof CLASS.prototype.resolvedOptions].join();"),
]
out = ['''// @ts-nocheck
import { sharedConstant, sharedTwin, sharedOptions, sharedOptionsTwin, makeFromShared, makeFromSharedTwin, early, earlyTwin } from "./shared.ts";
import { formatIn, giveOwnFormat, changePrototype, keep, useKept, changeOptions } from "./untyped.js";
import sloppy from "./sloppy.cjs";
const boxes = []; const hide = x => { boxes.push(x); return boxes.pop(); };
const attempt = f => { try { return f(); } catch (e) { return "throws " + e.constructor.name; } };
let cases = 0, mismatches = 0;
const differ = (label, a, b) => { cases++; if (a !== b) { mismatches++; console.log("MISMATCH " + label + " | constant " + JSON.stringify(a) + " | twin " + JSON.stringify(b)); } };''']
sub = lambda text, word, by: re.sub(r"\b%s\b" % word, lambda m: by, text)
k = 0
for kind, V, W in (("date", "1234567890123", "86399999"), ("number", "1234567.885", "-0.005")):
    l, o = D if kind == "date" else N; c = "Intl.DateTimeFormat" if kind == "date" else "Intl.NumberFormat"
    other = 'new %s(hide("ja"), hide({}))' % c
    for title, body in SCENES:
        k += 1; texts = []
        for constant in (True, False):
            a = "%s, %s" % (l, o) if constant else "hide(%s), hide(%s)" % (l, o)
            b = sub(sub(sub(sub(sub(sub(sub(sub(body, "MAKE_WITHOUT_NEW", "%s(%s)" % (c, a)), "MAKE3", "new %s(%s, 5)" % (c, a)), "MAKE", make(kind, constant)), "OTHER", other), "ARGS", "[%s]" % a), "CLASS", c), "V", V), "W", W)
            texts.append(b)
        out.append("function sceneC%d() { %s }\nfunction sceneT%d() { %s }\ndiffer(%s, String(attempt(sceneC%d)), String(attempt(sceneT%d)));" % (k, texts[0], k, texts[1], json.dumps(kind + ": " + title), k, k))
# ---- module-level variables in unusual states
out.append('''
// read before initialization
differ("const read in its dead zone", attempt(() => useLate(5)), "throws ReferenceError");
function useLate(v) { return late.format(v); }
const late = new Intl.NumberFormat("de", {});
differ("const read after initialization", useLate(1234.5), new Intl.NumberFormat(hide("de"), hide({})).format(1234.5));
differ("var read before initialization", attempt(() => useHoisted(5)), "throws TypeError");
function useHoisted(v) { return hoisted.format(v); }
var hoisted = new Intl.NumberFormat("de", {});
differ("imported, used by the other module before it was initialized", early, earlyTwin);
// reassigned in unusual ways
const replacement = new Intl.NumberFormat(hide("en-IN"), hide({}));
const expected = replacement.format(1234567.5);
let byDestructuring = new Intl.NumberFormat("de", {}); [byDestructuring] = [replacement]; differ("reassigned by array destructuring", byDestructuring.format(1234567.5), expected);
let byObjectPattern = new Intl.NumberFormat("de", {}); ({ x: byObjectPattern } = { x: replacement }); differ("reassigned by object destructuring", byObjectPattern.format(1234567.5), expected);
let byForOf = new Intl.NumberFormat("de", {}); for (byForOf of [replacement]); differ("reassigned by for-of", byForOf.format(1234567.5), expected);
let byForIn = new Intl.NumberFormat("de", {}); for (byForIn in { k: 1 }); differ("reassigned by for-in", attempt(() => byForIn.format(1)), "throws TypeError");
let byLogical = new Intl.NumberFormat("de", {}); byLogical &&= replacement; differ("reassigned by &&=", byLogical.format(1234567.5), expected);
let inFunction = new Intl.NumberFormat("de", {}); function swap() { inFunction = replacement; } const beforeSwap = inFunction.format(1234567.5); swap(); differ("reassigned in a function", beforeSwap + inFunction.format(1234567.5), new Intl.NumberFormat(hide("de"), hide({})).format(1234567.5) + expected);
let inArgument = new Intl.NumberFormat("de", {}); differ("reassigned while the argument is evaluated", inArgument.format((inArgument = replacement, 1234567.5)), new Intl.NumberFormat(hide("de"), hide({})).format(1234567.5));
let inDefault = new Intl.NumberFormat("de", {}); ((p = (inDefault = replacement)) => p)(); differ("reassigned in a default parameter", inDefault.format(1234567.5), expected);
let inCatch = new Intl.NumberFormat("de", {}); try { throw replacement; } catch (e) { inCatch = e; } differ("reassigned in a catch block", inCatch.format(1234567.5), expected);
let inClass = new Intl.NumberFormat("de", {}); class Static { static { inClass = replacement; } } differ("reassigned in a static block", inClass.format(1234567.5), expected);
let toNull = new Intl.NumberFormat("de", {}); toNull = null; differ("set to null", attempt(() => toNull.format(1)), "throws TypeError");
// shadowed
const outer = new Intl.NumberFormat("de", {});
differ("shadowed by a parameter", (outer => outer.format(1234567.5))(replacement), expected);
differ("shadowed in a block", (() => { { const outer = replacement; return outer.format(1234567.5); } })(), expected);
differ("shadowed by a catch parameter", (() => { try { throw replacement; } catch (outer) { return outer.format(1234567.5); } })(), expected);
differ("shadowed by a function's own name", (function outer() { return typeof outer.format; })(), "undefined");
// Intl shadowed or replaced
differ("Intl shadowed by a local", (() => { const Intl = { NumberFormat: class { format(v) { return "local " + v; } } }; return new Intl.NumberFormat("de", {}).format(5); })(), "local 5");
differ("Intl shadowed by a parameter", (Intl => new Intl.NumberFormat("de", {}).format(5))({ NumberFormat: class { format(v) { return "parameter " + v; } } }), "parameter 5");
differ("NumberFormat taken off Intl first", (() => { const { NumberFormat } = Intl; return new NumberFormat("de", {}).format(1234.5); })(), new Intl.NumberFormat(hide("de"), hide({})).format(1234.5));
differ("by globalThis.Intl", new globalThis.Intl.NumberFormat("de", {}).format(1234.5), new Intl.NumberFormat(hide("de"), hide({})).format(1234.5));
differ("by a computed name", new Intl["Number" + "Format"]("de", {}).format(1234.5), new Intl.NumberFormat(hide("de"), hide({})).format(1234.5));
// options kept in module constants
const plain = { minimumFractionDigits: 2 }; differ("options in a module constant", new Intl.NumberFormat("de", plain).format(5), new Intl.NumberFormat(hide("de"), hide({ minimumFractionDigits: 2 })).format(5));
const changedBefore = { minimumFractionDigits: 2 }; changedBefore.minimumFractionDigits = 4; differ("options changed before", new Intl.NumberFormat("de", changedBefore).format(5), "5,0000");
const changedByKey = { minimumFractionDigits: 2 }; changedByKey[hide("minimumFractionDigits")] = 4; differ("options changed by a computed key", new Intl.NumberFormat("de", changedByKey).format(5), "5,0000");
const changedByAssign = { minimumFractionDigits: 2 }; Object.assign(changedByAssign, { minimumFractionDigits: 4 }); differ("options changed by Object.assign", new Intl.NumberFormat("de", changedByAssign).format(5), "5,0000");
const changedByDefine = { minimumFractionDigits: 2 }; Object.defineProperty(changedByDefine, "minimumFractionDigits", { get() { return 4; } }); differ("options changed by defineProperty", new Intl.NumberFormat("de", changedByDefine).format(5), "5,0000");
const changedByDelete = { minimumFractionDigits: 2 }; delete changedByDelete.minimumFractionDigits; differ("an option deleted", new Intl.NumberFormat("de", changedByDelete).format(5), "5");
const changedByProto = { minimumFractionDigits: 2 }; Object.setPrototypeOf(changedByProto, { useGrouping: false }); differ("options given a prototype", new Intl.NumberFormat("de", changedByProto).format(1234), "1234,00");
const changedByAlias = { minimumFractionDigits: 2 }; const alias = changedByAlias; alias.minimumFractionDigits = 4; differ("options changed through an alias", new Intl.NumberFormat("de", changedByAlias).format(5), "5,0000");
const changedInHolder = { minimumFractionDigits: 2 }; const holder = { o: changedInHolder }; holder.o.minimumFractionDigits = 4; differ("options changed through a holder", new Intl.NumberFormat("de", changedInHolder).format(5), "5,0000");
const changedByUntyped = { minimumFractionDigits: 2 }; changeOptions(changedByUntyped); differ("options changed by untyped code", new Intl.NumberFormat("de", changedByUntyped).format(5), "5,0000");
const changedLater = { minimumFractionDigits: 2 }; function fromLater() { return new Intl.NumberFormat("de", changedLater).format(5); } const first = fromLater(); changedLater.minimumFractionDigits = 4; differ("options changed between two constructions", first + fromLater(), "5,005,0000");
const changedBySpreadTarget = { minimumFractionDigits: 2 }; const copy = { ...changedBySpreadTarget, minimumFractionDigits: 4 }; differ("a changed copy of the options", new Intl.NumberFormat("de", copy).format(5) + new Intl.NumberFormat("de", changedBySpreadTarget).format(5), "5,00005,00");
const seenByDate = { minimumFractionDigits: 2, timeZone: "UTC", year: "numeric" }; class Sly extends Date { toLocaleString(l, o) { o.minimumFractionDigits = 4; return "sly"; } } new Sly(0).toLocaleString("de", seenByDate); differ("options changed by a Date subclass's toLocaleString", new Intl.NumberFormat("de", seenByDate).format(5), "5,0000");
const seenByNumber = { minimumFractionDigits: 2 }; differ("options used by a number's toLocaleString too", (5).toLocaleString("de", seenByNumber) + new Intl.NumberFormat("de", seenByNumber).format(6), "5,006,00");
const seenByFake = { minimumFractionDigits: 2 }; hide({ toLocaleString(l, o) { o.minimumFractionDigits = 4; return ""; } }).toLocaleString("de", seenByFake); differ("options changed by something that only looks like a number", new Intl.NumberFormat("de", seenByFake).format(5), "5,0000");
const withThis = { minimumFractionDigits: 2, bump() { this.minimumFractionDigits = 4; } }; withThis.bump(); differ("options changed through this", new Intl.NumberFormat("de", withThis).format(5), "5,0000");
// across modules
differ("an exported formatter", sharedConstant.format(1234.5), sharedTwin.format(1234.5));
sharedOptions.minimumFractionDigits = 4; sharedOptionsTwin.minimumFractionDigits = 4;
differ("exported options changed by the importer", makeFromShared().format(5), makeFromSharedTwin().format(5));
for (const line of sloppy(hide)) differ("sloppy: " + line[0], line[1], line[2]);
console.log("cases " + cases + " | mismatches " + mismatches);''')
print("\n".join(out))
print("//// shared.ts"); sys.stdout.write('''// @ts-nocheck
const boxes = []; const hide = x => { boxes.push(x); return boxes.pop(); };
const attempt = f => { try { return f(); } catch (e) { return "throws " + e.constructor.name; } };
function useEarly() { return sharedConstant.format(5); }
function useEarlyTwin() { return sharedTwin.format(5); }
export const early = attempt(useEarly), earlyTwin = attempt(useEarlyTwin);
export const sharedConstant = new Intl.NumberFormat("de", { minimumFractionDigits: 2 });
export const sharedTwin = new Intl.NumberFormat(hide("de"), hide({ minimumFractionDigits: 2 }));
export const sharedOptions = { minimumFractionDigits: 2 };
export const sharedOptionsTwin = hide({ minimumFractionDigits: 2 });
export function makeFromShared() { return new Intl.NumberFormat("de", sharedOptions); }
export function makeFromSharedTwin() { return new Intl.NumberFormat(hide("de"), sharedOptionsTwin); }
''')
print("//// untyped.js"); sys.stdout.write('''let kept;
export function formatIn(f, v) { return f.format(v); }
export function giveOwnFormat(f) { Object.defineProperty(f, "format", { value: () => "own" }); }
export function changePrototype(f) { Object.setPrototypeOf(f, { format: () => "other prototype" }); }
export function keep(f) { kept = f; }
export function useKept(v) { return kept.format(v); }
export function changeOptions(o) { o.minimumFractionDigits = 4; }
''')
print("//// sloppy.cjs"); sys.stdout.write('''var byEval = new Intl.NumberFormat("de", {});
var byIndirect = new Intl.NumberFormat("de", {});
var byWith = new Intl.NumberFormat("de", {});
var byArguments = new Intl.NumberFormat("de", {});
var options = { minimumFractionDigits: 2 };
function run(code, replacement) { eval(code); }
module.exports = function (hide) {
  var replacement = new Intl.NumberFormat(hide("en-IN"), hide({})), expected = replacement.format(1234567.5), german = new Intl.NumberFormat(hide("de"), hide({})).format(1234567.5), lines = [];
  run("byEval = replacement", replacement); lines.push(["reassigned by direct eval", byEval.format(1234567.5), expected]);
  (0, eval)("var byIndirect = 5"); lines.push(["an indirect eval does not reach it", byIndirect.format(1234567.5), german]);
  (function (f) { arguments[0] = replacement; lines.push(["a parameter changed through arguments", f.format(1234567.5), expected]); })(byArguments);
  run("options.minimumFractionDigits = 4"); lines.push(["options changed by direct eval", new Intl.NumberFormat("de", options).format(5), "5,0000"]);
  return lines;
};
''')
