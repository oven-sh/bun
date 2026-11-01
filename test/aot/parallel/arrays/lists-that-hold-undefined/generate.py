# generate.py: writes the programs of this folder anew (then: prettier --write). generate.py <folder> [holes]: writes all 67 into that folder, for a sweep by hand; with `holes` four of the lists have holes.
# Programs that read a list of numbers and undefined as numbers in a loop AND ask its elements for undefined, in every order and nesting.
# One file for each way of reading and each placement; in it one function for each way of asking, called with seven lists. Stored here: the placements `after` and `around`.
import sys, os
stored = len(sys.argv) < 2
out = os.path.dirname(os.path.abspath(__file__)) if stored else sys.argv[1]; os.makedirs(out, exist_ok=True)
names = {
 "sumFor": "summed-in-a-for-loop", "sumOf": "summed-in-a-for-of-loop", "reduce": "summed-by-reduce", "forEach": "summed-by-for-each", "while": "summed-in-a-while-loop", "neighbors": "summed-with-its-neighbors",
 "spread": "spread-into-a-call", "max": "searched-for-the-greatest", "fixed": "read-at-fixed-positions", "times": "walked-from-the-end",
 "after": "then-asked-for-undefined", "around": "and-asked-for-undefined-in-a-loop-around-both",
}
note = '''// Written by ./generate.py, formatted by prettier. A list that holds numbers and undefined is read as numbers in a loop, and its elements are asked for undefined in 129 ways, each in a function of its own.
// The loop's reads are compiled for Double storage and copied for storage that holds any value. Behind the proof of Double storage `list[i] === undefined` is false: the copy may not go on into code that says so.
'''
head = '''let out = "";
function note(value) { out += String(value) + ";"; }
function nothing() {}
function sum3(a, b, c) { return a + b + c; }
function orNine(x = 9) { return x; }
const lists = () => [
  [-1, 7, ([])[0]],
  Array.from({ length: 3 }, (each, at) => (at === 1 ? nothing() : 1)),
  [1, 2, 3].map(x => x),
  [1.5, 2.5, 3.5],
  [([])[0], 4, 5],
  [1, 2, 3, 4, 5, 6, 7, 8].map(x => (x % 3 ? x : nothing())),
  [nothing(), nothing(), nothing()],MORE
];
'''
head = head.replace("MORE", "\n  [1, , 3],\n  [, 2.5, 3.5],\n  new Array(3),\n  (() => { const list = [1, 2, 3, 4]; delete list[2]; return list; })()," if len(sys.argv) > 2 else "")
reads = {
 "sumFor": "{ let sum = 0; for (let i = 0; i < list.length; i++) { sum += list[i]; INSIDE } note(sum); }",
 "sumOf": "{ let sum = 0; for (const each of list) sum += each; note(sum); }",
 "reduce": "{ note(list.reduce((a, b) => a + b, 0)); }",
 "forEach": "{ let sum = 0; list.forEach(each => { sum += each; }); note(sum); }",
 "while": "{ let sum = 0, i = 0; while (i < list.length) { sum += list[i]; INSIDE i++; } note(sum); }",
 "neighbors": "{ let sum = 0; for (let i = 1; i < list.length; i++) { sum += list[i] + list[i - 1]; INSIDE } note(sum); }",
 "spread": "{ let sum = 0; for (let i = 0; i < 3; i++) { sum += sum3(...list); INSIDE } note(sum); }",
 "max": "{ let most = -Infinity; for (let i = 0; i < list.length; i++) { if (list[i] > most) most = list[i]; INSIDE } note(most); }",
 "fixed": "{ let sum = 0; for (let i = 0; i < 4; i++) { sum += list[0] + list[2]; INSIDE } note(sum); }",
 "times": "{ let sum = 0; for (let i = list.length - 1; i >= 0; i--) { sum += list[i] * 2; INSIDE } note(sum); }",
}
questions = {
 "strict": "X === undefined", "loose": "X == null", "typeof": 'typeof X === "undefined"', "void": "X === void 0", "is": "Object.is(X, undefined)",
 "coalesce": "(X ?? 100) === 100", "notNumber": 'typeof X !== "number"', "default": "orNine(X) === 9", "string": 'String(X) === "undefined"', "chain": "X?.toFixed === undefined",
 "inList": "[X].includes(undefined)", "isNaN": "isNaN(X)", "notSelf": "X !== X", "not": "!X", "or": "(X || 50) === 50", "switch": "(() => { switch (X) { case undefined: return true; default: return false; } })()",
}
walks = {
 "for": "{ let count = 0; for (let j = 0; j < list.length; j++) if (Q(list[j])) count++; note(count); }",
 "of": "{ let count = 0; for (const e of list) if (Q(e)) count++; note(count); }",
 "findIndex": "{ note(list.findIndex(e => Q(e))); }",
 "filter": "{ note(list.filter(e => Q(e)).length); }",
 "some": "{ note(list.some(e => Q(e))); }",
 "findLast": "{ note(list.findLastIndex(e => Q(e))); }",
 "down": "{ let count = 0; for (let j = list.length - 1; j >= 0; j--) if (Q(list[j])) count++; note(count); }",
}
whole = {
 "includes": "{ note(list.includes(undefined)); }", "indexOf": "{ note(list.indexOf(undefined)); }", "lastIndexOf": "{ note(list.lastIndexOf(undefined)); }", "join": '{ note(list.join("-")); }',
 "json": "{ note(JSON.stringify(list)); }", "destructure": "{ const [a = 10, b = 20, c = 30] = list; note(a + b + c); }", "at": "{ note(list.at(-1) === undefined); note(list.at(0) === undefined); }",
 "maxSpread": "{ note(Math.max(...list)); }", "mapJoin": '{ note(list.map(e => (e === undefined ? 1 : 0)).join("")); }', "entries": "{ let count = 0; for (const [at, e] of list.entries()) if (e === undefined) count += at + 1; note(count); }",
 "forIn": "{ let count = 0; for (const at in list) if (list[at] === undefined) count++; note(count); }", "first": "{ note(list[0] === undefined); note(list[1] === undefined); note(list[2] === undefined); }",
 "every": "{ note(list.every(e => e !== undefined)); }", "find": "{ note(list.find(e => e === undefined || e > 5)); }", "copy": "{ note([...list].indexOf(undefined)); note(list.slice().includes(undefined)); }",
 "sortless": "{ note(list.toString()); }", "flat": "{ note(list.flat().length); note(list.concat([1]).includes(undefined)); }",
}
asks = {}
for w, text in walks.items():
    for q, expression in questions.items():
        body = text
        while "Q(" in body:
            at = body.index("Q("); end = body.index(")", at); body = body[:at] + "(" + expression.replace("X", body[at + 2:end]) + ")" + body[end + 1:]
        asks[w + "_" + q] = body
asks.update(whole)
placements = {
 "after": lambda r, a: r + "\n  " + a,
 "before": lambda r, a: a + "\n  " + r,
 "around": lambda r, a: "for (let round = 0; round < 2; round++) {\n  " + r + "\n  " + a + "\n  }",
 "helper": None,
 "guarded": lambda r, a: "try {\n  " + r + "\n  " + a + "\n  } catch (error) { note(error); }",
 "twice": lambda r, a: r + "\n  " + a + "\n  " + r + "\n  " + a,
}
files = 0
for r, read in reads.items():
    plain = read.replace("INSIDE ", "")
    for p, place in placements.items():
        if stored and p not in names: continue
        text = (note if stored else "") + head
        for a, ask in asks.items():
            name = "w_" + a
            if p == "helper": text += "function ask_%s(list) {\n  %s\n}\nfunction %s(list) {\n  %s\n  ask_%s(list);\n}\n" % (a, ask, name, plain, a)
            else: text += "function %s(list) {\n  %s\n}\n" % (name, place(plain, ask))
            text += 'out += "\\n%s: "; for (const list of lists()) %s(list);\n' % (a, name)
        open("%s/%s-%s.js" % (out, names[r], names[p]) if stored else "%s/adv-%s-%s.js" % (out, r, p), "w").write(text + "console.log(out);\n"); files += 1
    if stored or "INSIDE" not in read: continue
    text = head
    for q, expression in questions.items():
        for o, position in {"same": "list[i]", "next": "list[i + 1]", "last": "list[i - 1]", "zero": "list[0]", "two": "list[2]", "end": "list[list.length - 1]"}.items():
            name = "w_%s_%s" % (q, o)
            text += "function %s(list) {\n  let count = 0;\n  %s\n  note(count);\n}\n" % (name, read.replace("INSIDE", "if (%s) count++;" % expression.replace("X", position)))
            text += 'out += "\\n%s_%s: "; for (const list of lists()) %s(list);\n' % (q, o, name)
    open("%s/adv-%s-inside.js" % (out, r), "w").write(text + "console.log(out);\n"); files += 1
print(files, "files,", len(asks), "ways of asking")
