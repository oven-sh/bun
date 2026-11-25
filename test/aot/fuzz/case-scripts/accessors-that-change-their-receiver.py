#!/usr/bin/env python3
"""accessors-that-change-their-receiver.py <folder>: A getter or a setter does something to `this` that nothing else in the
program does: it adds, deletes or retypes a member, freezes the object, gives it another prototype, calls a method that nobody
else calls. Crossed with how the accessor is laid, whether the key is written or computed, how the receiver comes to the
place, what triggers the accessor, and which foreign object comes to the same place (one that took descriptors out of
JSON.parse(), or a list beside node:util). 7,488 programs. What each prints never does what the accessor does.
"""
import os, sys, itertools
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
ACTS = {
 "adds": ("this.seen = 1;", "typeof t.seen"), "deletes": ("delete this.port;", 'String(t.port) + ("port" in t)'),
 "freezes": ("Object.freeze(this);", "Object.isFrozen(t) + String(tried(() => { t.port = 81; return t.port; }))"), "retypes": ('this.port = "text";', "typeof t.port"),
 "reproto": ("Object.setPrototypeOf(this, { q: 1 });", "String(t.q)"), "calls": ("this.bump?.();", "String(hits)"),
}
FOREIGN = {"parsed": ("", 'Object.defineProperties({}, JSON.parse("{}"))'), "list": ('import "node:util";\n', "[]")}
def accessor(kind, act): return f"get() {{ {act} return 1; }}" if kind == "get" else f"set(v) {{ {act} }}"
def member(kind, act): return f"get value() {{ {act} return 1; }}" if kind == "get" else f"set value(v) {{ {act} }}"
LAID = ["defineProperty", "defineProperties", "reflect", "assigned", "class", "literal"]
KEYS = {"written": ("t.value", '"value"'), "computed": ("t[KEY]", "KEY")}
TRIGGERS = {
 "get": {"read": "{R};", "template": "`${{{R}}}`;", "destructuring": "const {{ [{K}]: got }} = t;", "spread": "({{ ...t }});", "stringify": "JSON.stringify(t);", "entries": "Object.entries(t);", "reflect": "Reflect.get(t, {K});"},
 "set": {"write": "{R} = 1;", "compound": "{R} += 1;", "destructuring": "({{ a: {R} }} = {{ a: 1 }});", "assign": "Object.assign(t, {{ [{K}]: 1 }});", "reflect": "Reflect.set(t, {K}, 1);", "loop": "for ({R} of [1]);"},
}
RECEIVERS = ["known", "either", "parameter", "element"]
n = 0
for kind in ("get", "set"):
  for (an, (act, see)), laid, (kn, (R, K)), recv, (tn, trig), (fn, (head, foreign)) in itertools.product(ACTS.items(), LAID, KEYS.items(), RECEIVERS, TRIGGERS[kind].items(), FOREIGN.items()):
    enumerable = "enumerable: true, configurable: true, "
    cls = "class Row { port = 80; bump() { hits++; } " + (member(kind, act) if laid == "class" else "") + " }"
    make = "new Row()" if laid != "literal" else "{ port: 80, bump() { hits++; }, " + member(kind, act) + " }"
    d = "{ " + enumerable + accessor(kind, act) + " }"
    lay = {"defineProperty": f'Object.defineProperty(t, "value", {d});', "defineProperties": f"Object.defineProperties(t, {{ value: {d} }});", "reflect": f'Reflect.defineProperty(t, "value", {d});',
           "assigned": f'Object.defineProperty(t, "value", Object.assign({{}}, {d}));', "class": "", "literal": ""}[laid]
    body = f"  {lay}\n  {trig.format(R=R, K=K)}\n  return {see};\n"
    if recv == "known": fun = f"function peek() {{\n  const t = {make};\n{body}}}\nfunction other(t) {{\n{body}}}\n"; calls = ["peek()", f"other({foreign})"]
    elif recv == "either": fun = f"function peek(base) {{\n  const t = base ?? {make};\n{body}}}\n"; calls = ["peek()", f"peek({foreign})"]
    elif recv == "parameter": fun = f"function peek(t) {{\n{body}}}\n"; calls = [f"peek({make})", f"peek({foreign})"]
    else: fun = f"const all = [{make}, {foreign}];\nfunction peek(i) {{\n  const t = all[i];\n{body}}}\n"; calls = ["peek(0)", "peek(1)"]
    text = head + "let hits = 0;\nconst tried = f => { try { return f(); } catch (e) { return e.name; } };\nconst KEY = JSON.parse('\"value\"');\n" + cls + "\n" + fun + "".join(f"console.log(String(tried(() => {c})));\n" for c in calls)
    open(f"{out}/{kind}-{an}-{laid}-{kn}-{recv}-{tn}-{fn}.js", "w").write(text); n += 1
