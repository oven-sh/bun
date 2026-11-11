#!/usr/bin/env python3
"""setters-under-keys-known-at-run-time.py <folder>: `o[KEY] = v` runs a setter laid by Object.defineProperty() that does
something to `this`, where `o` is an instance of a class or a list, beside node:util. What the setter does x how the key is
given x what is stored; a method that only such a setter calls (bump-*); and the sister roads of a store and of a read
(road-*): compound stores, destructuring, loop heads, Reflect.set(), Object.assign(), inherited setters, getters.
"""
import os, sys

os.makedirs(sys.argv[1], exist_ok=True)
os.chdir(sys.argv[1])
PREFIX = {"f46": "", "f13": "bump-", "roads": "road-"}
def path(folder, name): return PREFIX[folder] + (name.split("-", 1)[1] if folder == "f13" else name) + ".js"
def w(folder, name, text): open(path(folder, name), "w").write(text)
DOES = {
 "del": "delete this.z;", "dge": 'Object.defineProperty(this, "z", { get() { return 7; }, configurable: true });', "ron": 'Object.defineProperty(this, "z", { writable: false });',
 "sea": "Object.seal(this);", "frz": "Object.freeze(this);", "pre": "Object.preventExtensions(this);", "sto": "this.z = 5;", "txt": 'this.z = "t";', "add": "this.n = 1;",
 "dva": 'Object.defineProperty(this, "z", { value: 3 });', "pro": "Object.setPrototypeOf(this, { q: 1 });",
}
VAL = {"int": "1", "fra": "1.5", "txt": '"s"'}
LOOK = '''  const tried = f => { try { return String(f()); } catch (e) { return e.name; } };
  return [String(o.z), Object.keys(o).join("+"), tried(() => { "use strict"; o.z = 9; return o.z; }), tried(() => { "use strict"; o.m = 1; return "m" in o; }), String(o.q), Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)].join(" ");'''
def frame(does, store, look=LOOK, cls="class C { z = 0; }", head='import "node:util";\n', extra=""):
    return head + cls + "\n" + extra + "const KEY = JSON.parse('\"p\"');\nfunction run(given) {\n  const o = given ?? new C();\n  Object.defineProperty(o, \"p\", { set(v) { " + does + " } });\n  " + store + "\n" + look + "\n}\nconsole.log(\"\" + run());\ntry { console.log(\"\" + run([])); } catch (e) { console.log(e.name); }\n"
for d, body in DOES.items():
    for v, text in VAL.items(): w("f46", f"{d}-run-{v}", frame(body, f"o[KEY] = {text};"))
    w("f46", f"{d}-wri-int", frame(body, "o.p = 1;"))
short = "  return JSON.stringify(o.z);"
w("f46", "a0", frame("delete this.z;", "o[KEY] = 1;", short)); w("f46", "a1", frame("delete this.z;", "o[KEY] = 1.5;", short))

B = 'let hits = 0;\n'
def bump(lay, store="o[KEY] = 1;", cls="class C { z = 0; bump() { hits++; } }", call="this.bump();", pre=""):
    return 'import "node:util";\n' + B + cls.replace("CALL", call) + "\n" + pre.replace("CALL", call) + "const KEY = JSON.parse('\"p\"');\nfunction run(given) {\n  const o = given ?? new C();\n  " + lay.replace("CALL", call) + "\n  " + store + "\n  return hits;\n}\ntry { console.log(\"\" + run()); } catch (e) { console.log(e.name + \": \" + e.message.slice(0, 40)); }\ntry { console.log(\"\" + run([])); } catch (e) { console.log(e.name); }\n"
DP = 'Object.defineProperty(o, "p", { set(v) { CALL } });'
F13 = {
 "01-define-property": bump(DP), "02-fraction": bump(DP, "o[KEY] = 1.5;"), "03-text": bump(DP, 'o[KEY] = "s";'),
 "04-define-properties": bump('Object.defineProperties(o, { p: { set(v) { CALL } } });'),
 "05-no-field": bump(DP, cls="class C { bump() { hits++; } }"),
 "06-method-with-argument": bump(DP, cls="class C { z = 0; bump(v) { hits += v; } }", call="this.bump(v);"),
 "07-method-by-key": bump(DP, call='this["bu" + "mp"]();'),
 "08-two-methods": bump(DP, cls="class C { z = 0; bump() { this.more(); } more() { hits++; } }"),
 "09-static-helper": bump(DP, cls="class C { z = 0; bump() { C.count(); } static count() { hits++; } }"),
 "10-getter-called": bump(DP, cls="class C { z = 0; get bump() { hits++; return 1; } }", call="this.bump;"),
 "11-reflect-define": bump('Reflect.defineProperty(o, "p", { set(v) { CALL } });'),
 "12-descriptor-made-elsewhere": bump('Object.defineProperty(o, "p", descriptor);', pre="const descriptor = { set(v) { CALL } };\n"),
 "13-map-beside": bump(DP).replace("run([])", "run(new Map())"),
}
for k, t in F13.items(): w("f13", k, t)

def road(name, store, does="Object.freeze(this);", **k): w("roads", name, frame(does, store, **k))
road("reflect-set", "Reflect.set(o, KEY, 1.5);"); road("reflect-set-receiver", "Reflect.set(o, KEY, 1.5, o);")
road("assign-computed", "Object.assign(o, { [KEY]: 1.5 });"); road("assign-parsed", "Object.assign(o, JSON.parse('{\"p\":1.5}'));")
road("destructure-list", "[o[KEY]] = [1.5];"); road("destructure-object", "({ a: o[KEY] } = { a: 1.5 });"); road("for-of-head", "for (o[KEY] of [1.5]);"); road("for-in-head", "for (o[KEY] in { a: 1 });")
road("compound", "o[KEY] += 1.5;"); road("increment", "o[KEY]++;"); road("nullish", "o[KEY] ??= 1.5;"); road("or-assign", "o[KEY] ||= 1.5;")
road("entries-loop", "for (const [k, v] of Object.entries(JSON.parse('{\"p\":1.5}'))) o[k] = v;"); road("keys-loop", "const from = JSON.parse('{\"p\":1.5}'); for (const k in from) o[k] = from[k];")
road("helper", "put(o, KEY, 1.5);", extra="const put = (target, key, value) => { target[key] = value; };\n")
road("symbol-key", "o[SYM] = 1.5;", extra="const SYM = [Symbol.for(\"s\")][0];\n").__class__
open("road-symbol-key.js", "w").write(open("road-symbol-key.js").read().replace('Object.defineProperty(o, "p",', "Object.defineProperty(o, SYM,"))
road("index-key", "o[IDX] = 1.5;", extra="const IDX = JSON.parse('3');\n")
open("road-index-key.js", "w").write(open("road-index-key.js").read().replace('Object.defineProperty(o, "p",', "Object.defineProperty(o, 3,"))
road("bump-reflect-set", "Reflect.set(o, KEY, 1);", does="this.bump();", cls="class C { z = 0; bump() { hits++; } }", extra="let hits = 0;\n", look="  return hits;")
road("bump-assign", "Object.assign(o, { [KEY]: 1 });", does="this.bump();", cls="class C { z = 0; bump() { hits++; } }", extra="let hits = 0;\n", look="  return hits;")
# inherited setters, class and literal setters
def proto(name, lay, store="o[KEY] = 1.5;"):
    w("roads", name, 'import "node:util";\n' + lay + "\nconst KEY = JSON.parse('\"p\"');\nfunction run(given) {\n  const o = given ?? new C();\n  " + store + "\n" + LOOK + "\n}\nconsole.log(\"\" + run());\ntry { console.log(\"\" + run([])); } catch (e) { console.log(e.name); }\n")
proto("class-setter", "class C { z = 0; set p(v) { Object.freeze(this); } }"); proto("base-class-setter", "class A { set p(v) { Object.freeze(this); } }\nclass C extends A { z = 0; }")
proto("prototype-setter", 'class C { z = 0; }\nObject.defineProperty(C.prototype, "p", { set(v) { Object.freeze(this); } });')
proto("define-setter", 'class C { z = 0; }\nC.prototype.__defineSetter__("p", function (v) { Object.freeze(this); });')
# getters
def getter(name, read, does="Object.freeze(this); return 1;", enumerable="false"):
    w("roads", "get-" + name, 'import "node:util";\nclass C { z = 0; }\nconst KEY = JSON.parse(\'"p"\');\nfunction run(given) {\n  const o = given ?? new C();\n  Object.defineProperty(o, "p", { get() { ' + does + ' }, enumerable: ' + enumerable + ' });\n  ' + read + "\n" + LOOK + "\n}\nconsole.log(\"\" + run());\ntry { console.log(\"\" + run([])); } catch (e) { console.log(e.name); }\n")
getter("by-key", "o[KEY];"); getter("reflect-get", "Reflect.get(o, KEY);"); getter("values", "Object.values(o);", enumerable="true"); getter("stringify", "JSON.stringify(o);", enumerable="true")
getter("spread", "({ ...o });", enumerable="true"); getter("entries", "Object.entries(o);", enumerable="true"); getter("for-in", "for (const k in o) o[k];", enumerable="true"); getter("assign-from", "Object.assign({}, o);", enumerable="true")
getter("destructure", "const { [KEY]: got } = o;"); getter("delete", "o[KEY];", does="delete this.z; return 1;"); getter("seal", "o[KEY];", does="Object.seal(this); return 1;")
w("roads", "get-bump", 'import "node:util";\nlet hits = 0;\nclass C { z = 0; bump() { hits++; } }\nconst KEY = JSON.parse(\'"p"\');\nfunction run(given) {\n  const o = given ?? new C();\n  Object.defineProperty(o, "p", { get() { this.bump(); return 1; } });\n  o[KEY];\n  return hits;\n}\ntry { console.log("" + run()); } catch (e) { console.log(e.name + ": " + e.message.slice(0, 40)); }\ntry { console.log("" + run([])); } catch (e) { console.log(e.name); }\n')
