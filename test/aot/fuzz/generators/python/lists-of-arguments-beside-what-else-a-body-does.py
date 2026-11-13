#!/usr/bin/env python3
"""lists-of-arguments-beside-what-else-a-body-does.py <seed>: Random JavaScript functions that use `arguments` or a rest
list, each stored in a table and called out of it with none to seven arguments. The list is read, changed by every road,
kept, handed on by apply() and by a spread, early or late, on one way or on all: behind early returns, joins, loops and
handlers. Beside it stands whatever else a compiler does with a body: generators that a for-of consumes, iteration by
index, for-in, switches, arrows that capture `arguments`, texts that grow, patterns, labels, methods of two classes.
"""
import random, sys
r = random.Random(int(sys.argv[1]))

def cond(kind):
    own = ["arguments.length > %d" % r.randint(0, 3), "arguments.length === %d" % r.randint(0, 3)] if kind == "arguments" else ["rest.length > %d" % r.randint(0, 2), "rest.length === %d" % r.randint(0, 2)]
    return r.choice(["a === %d" % r.randint(0, 2), "a > %d" % r.randint(0, 2), "flag", "!flag", "a === undefined"] * 2 + own)

def expr(kind):
    if kind == "arguments":
        return r.choice(["arguments.length", "arguments.length", "arguments.length", "arguments[0]", "arguments[1]", "typeof arguments", "join(arguments)", "a", "Object.keys(arguments).length", "seen(arguments)"] + ["fwd.apply(this, arguments)", "fwd.apply(null, arguments)", "fwd.apply(box, arguments)", "take(1, arguments)", "odd.apply(null, arguments)"] * 2)
    return r.choice(["rest.length", "rest.length", "rest[0]", "rest.join()", "a", "seen(rest)", "Array.isArray(rest)"])

def change(kind):
    if kind == "arguments":
        return r.choice(["arguments.length = %d;" % r.randint(0, 5), "arguments[0] = 9;", "arguments[%d] = 8;" % r.randint(1, 4), "delete arguments.length;", "delete arguments[0];", "Array.prototype.push.call(arguments, 7);", "Array.prototype.pop.call(arguments);", "kept = arguments;", "a = 5;", "touch(arguments);", "Object.defineProperty(arguments, 'length', { value: 6 });", "flag = !flag;", "Array.prototype.shift.call(arguments);"])
    return r.choice(["rest.push(1);", "rest.length = 0;", "rest[0] = 9;", "kept = rest;", "a = 5;", "touch(rest);", "rest.pop();", "flag = !flag;", "rest.unshift(3);"])

def beside(kind, depth):
    own = "arguments" if kind == "arguments" else "rest"
    e = lambda: expr(kind)
    return r.choice([
        "for (const v of pair(a, %d)) { out.push(v, %s); }" % (r.randint(0, 3), e()),
        "for (const v of pair(a, 2)) { if (%s) break; out.push(v * %s.length); }" % (cond(kind), own),
        "for (const v of upTo(%s.length)) { out.push(v); %s }" % (own, stmt(kind, depth + 1) if depth < 2 else ""),
        "for (const v of guarded(a)) { out.push(v, %s); if (%s) return out.join() + '!' + %s; }" % (e(), cond(kind), e()),
        "for (const v of %s) { out.push(v); }" % own,
        "for (const v of [1, a, %s]) { out.push(v); }" % e(),
        "for (const [i, v] of [a, 2].entries()) { out.push(i, v, %s); }" % e(),
        "for (var k in { x: 1, y: a }) { out.push(k, %s); }" % e(),
        "for (var k in %s) { out.push(k); }" % own,
        "switch (a) { case 0: out.push(%s); break; case 1: %s case 2: out.push(%s); break; default: %s }" % (e(), change(kind), e(), stmt(kind, depth + 1) if depth < 2 else "out.push(0);"),
        "out.push((() => %s)());" % e(),
        "var late%d = () => %s; %s out.push(late%d());" % (depth, e(), change(kind), depth),
        "var text%d = ''; for (var j%d = 0; j%d < %d; j%d++) { text%d += %s; } out.push(text%d);" % (depth, depth, depth, r.randint(1, 3), depth, depth, e(), depth),
        "var [p%d, q%d = 7, ...others%d] = %s; out.push(p%d, q%d, others%d.length);" % (depth, depth, depth, own, depth, depth, depth),
        "var { length: n%d, 0: z%d } = %s; out.push(n%d, z%d);" % (depth, depth, own, depth, depth),
        "out.push(fwd(...%s));" % own,
        "out.push(fwd(a, ...%s, 1));" % own,
        "out.push(Math.max(0, ...%s.length ? [1, 2] : []));" % own,
        "out.push(one(a).say(%s));" % e(),
        "out.push(one(%s.length).say(...%s));" % (own, own),
        "outer%d: for (var m%d = 0; m%d < 2; m%d++) { for (var w%d = 0; w%d < 2; w%d++) { if (%s) continue outer%d; if (%s) break outer%d; out.push(%s); } }" % (depth, depth, depth, depth, depth, depth, depth, cond(kind), depth, cond(kind), depth, e()),
        "var turns%d = 0; while (turns%d++ < 3) { if (%s) break; out.push(%s); }" % (depth, depth, cond(kind), e()),
        "function inner%d() { return arguments.length + ':' + join(arguments); } out.push(inner%d(a, %s));" % (depth, depth, e()),
        "out.push(new Pair(a, %s).sum());" % e(),
        "out.push(`${a}-${%s}`);" % e(),
        "out.push([%s, a].map(x => x + '' + %s.length).join('+'));" % (e(), own),
        "out.push(a?.tag ?? %s);" % e(),
    ])

def stmt(kind, depth):
    if r.random() < 0.35: return beside(kind, depth)
    k = r.random()
    if k < 0.22: return "if (%s) return out.join() + '|' + %s;" % (cond(kind), expr(kind))
    if k < 0.40: return "if (%s) { %s }" % (cond(kind), change(kind))
    if k < 0.52: return "if (%s) { %s } else { %s }" % (cond(kind), block(kind, depth + 1), block(kind, depth + 1)) if depth < 2 else "out.push(%s);" % expr(kind)
    if k < 0.60 and depth < 2: return "for (var i%d = 0; i%d < %d; i%d++) { %s }" % (depth, depth, r.randint(1, 3), depth, block(kind, depth + 1))
    if k < 0.68 and depth < 2: return "try { %s if (%s) throw 1; %s } catch (e) { %s }%s" % (block(kind, depth + 1), cond(kind), block(kind, depth + 1), block(kind, depth + 1), " finally { %s }" % ("out.push(%s);" % expr(kind)) if r.random() < 0.4 else "")
    if k < 0.74: return change(kind)
    return "out.push(%s);" % expr(kind)

def block(kind, depth):
    return " ".join(stmt(kind, depth) for _ in range(r.randint(1, 3)))

print('var kept, flag = false; function join(l) { return Array.prototype.join.call(l); } function seen(l) { return l.length + ":" + join(l); } function touch(l) { if (l.length > 1) l[1] = "t"; if (l.length > 3) l.length = 2; }')
print('var box = { tag: "B" }; function fwd(x, y, z) { return "<" + [this && this.tag, arguments.length, x, y, z].join("/") + ">"; } function take(n, l) { if (l.length > 2) l[0] = "w"; return n + l.length; } var odd = { apply: function (self, l) { return "odd" + l.length; } };')
print('function* pair(x, y) { yield x; yield y; } function* upTo(n) { for (var i = 0; i < n; i++) yield i; } function* guarded(x) { try { yield x; yield 1; } finally { kept = "closed"; } }')
print('class First { say(x, y) { return "1" + x + arguments.length; } } class Second { say(...all) { return "2" + all.length + all[0]; } } var both = [new First(), new Second()]; function one(n) { return both[n & 1]; }')
print('class Pair { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + "&" + this.y; } }')
print("var fs = {};")
for n in range(30):
    kind = r.choice(["arguments", "arguments", "rest"])
    strict = '"use strict"; ' if kind == "arguments" and r.random() < 0.5 else ""
    head = "function (a, ...rest)" if kind == "rest" else r.choice(["function (a)", "function ()", "function (a, b)"])
    body = " ".join(stmt(kind, 0) for _ in range(r.randint(2, 6)))
    if head == "function ()": body = "var a = arguments[0]; " + body if r.random() < 0.5 else "var a = 1; " + body
    print("fs.f%d = %s { %svar out = []; %s return out.join() + '.' + %s; };" % (n, head, strict, body, expr(kind)))
print("globalThis.fs = fs; var table = globalThis.fs;")
print("var lists = [[], [0], [1], [2], [1, 2], [0, 1, 2], [2, 3, 4, 5, 6, 7, 8], [undefined, 1]];")
print("for (var name in table) { var line = name; for (var list of lists) { flag = false; var got; try { switch (list.length) { case 0: got = table[name](); break; case 1: got = table[name](list[0]); break; case 2: got = table[name](list[0], list[1]); break; case 3: got = table[name](list[0], list[1], list[2]); break; default: got = table[name](...list); } } catch (e) { got = 'threw ' + (e && e.constructor ? e.constructor.name : e); } line += ' ; ' + got; } console.log(line); }")
