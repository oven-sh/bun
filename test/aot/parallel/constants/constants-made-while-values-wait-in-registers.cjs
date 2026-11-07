// A text, a key or an object of the engine that a function names is made when the function first comes to it, while other values wait in registers.
// Each function is held against its own text evaluated at run time. 424242: what a build with stubs broken on purpose changes, and nothing else: the red control of this program.
const launder = new Function("x", "return x");
const sink = new Function("...list", "return list.map(String).join('|')");
let cases = 0, wrongCases = 0;
function check(name, use, text) {
  const evaluated = new Function("sink", "a", "b", "c", "d", text);
  let wrong = 0, first = "";
  for (let round = 0; round < 3; round++) {
    const list = launder([424242, 424242, 424242, 424242]);
    let got, want;
    try { got = String(use(sink, ...list)); } catch (error) { got = "threw " + error; }
    try { want = String(evaluated(sink, ...list)); } catch (error) { want = "threw " + error; }
    if (got !== want && !wrong++) first = "round " + round + ": " + got + " <> " + want;
  }
  cases++;
  if (wrong) { wrongCases++; console.log(name, "wrong", wrong, first); }
}
check("constants 0", function (sink, a, b, c, d) { return sink(a, 'text 0 0', b, 'text 0 1', c, 'text 0 2', d, 'text 0 3'); }, "return sink(a, 'text 0 0', b, 'text 0 1', c, 'text 0 2', d, 'text 0 3');");
check("constants 1", function (sink, a, b, c, d) { return [sink(a, 'text 1 0'), sink(b, 'text 1 1'), sink(c, 'text 1 2'), sink(d, 'text 1 3')].join(); }, "return [sink(a, 'text 1 0'), sink(b, 'text 1 1'), sink(c, 'text 1 2'), sink(d, 'text 1 3')].join();");
check("constants 2", function (sink, a, b, c, d) { const o = { a, t: 'text 2 0', b, u: 'text 2 1', c, v: 'text 2 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 2 0', b, u: 'text 2 1', c, v: 'text 2 2', d }; return sink(JSON.stringify(o));");
check("constants 3", function (sink, a, b, c, d) { const l = [a, 'text 3 0', b, 'text 3 1', c, 'text 3 2', d]; return sink(l); }, "const l = [a, 'text 3 0', b, 'text 3 1', c, 'text 3 2', d]; return sink(l);");
check("constants 4", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 5", function (sink, a, b, c, d) { const o = {}; o['key 5 0'] = a; o['key 5 1'] = b; o['key 5 2'] = c; o['key 5 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 5 0'] = a; o['key 5 1'] = b; o['key 5 2'] = c; o['key 5 3'] = d; return sink(JSON.stringify(o));");
check("constants 6", function (sink, a, b, c, d) { return sink(a, 'text 6 0', b, 'text 6 1', c, 'text 6 2', d, 'text 6 3'); }, "return sink(a, 'text 6 0', b, 'text 6 1', c, 'text 6 2', d, 'text 6 3');");
check("constants 7", function (sink, a, b, c, d) { return [sink(a, 'text 7 0'), sink(b, 'text 7 1'), sink(c, 'text 7 2'), sink(d, 'text 7 3')].join(); }, "return [sink(a, 'text 7 0'), sink(b, 'text 7 1'), sink(c, 'text 7 2'), sink(d, 'text 7 3')].join();");
check("constants 8", function (sink, a, b, c, d) { const o = { a, t: 'text 8 0', b, u: 'text 8 1', c, v: 'text 8 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 8 0', b, u: 'text 8 1', c, v: 'text 8 2', d }; return sink(JSON.stringify(o));");
check("constants 9", function (sink, a, b, c, d) { const l = [a, 'text 9 0', b, 'text 9 1', c, 'text 9 2', d]; return sink(l); }, "const l = [a, 'text 9 0', b, 'text 9 1', c, 'text 9 2', d]; return sink(l);");
check("constants 10", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 11", function (sink, a, b, c, d) { const o = {}; o['key 11 0'] = a; o['key 11 1'] = b; o['key 11 2'] = c; o['key 11 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 11 0'] = a; o['key 11 1'] = b; o['key 11 2'] = c; o['key 11 3'] = d; return sink(JSON.stringify(o));");
check("constants 12", function (sink, a, b, c, d) { return sink(a, 'text 12 0', b, 'text 12 1', c, 'text 12 2', d, 'text 12 3'); }, "return sink(a, 'text 12 0', b, 'text 12 1', c, 'text 12 2', d, 'text 12 3');");
check("constants 13", function (sink, a, b, c, d) { return [sink(a, 'text 13 0'), sink(b, 'text 13 1'), sink(c, 'text 13 2'), sink(d, 'text 13 3')].join(); }, "return [sink(a, 'text 13 0'), sink(b, 'text 13 1'), sink(c, 'text 13 2'), sink(d, 'text 13 3')].join();");
check("constants 14", function (sink, a, b, c, d) { const o = { a, t: 'text 14 0', b, u: 'text 14 1', c, v: 'text 14 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 14 0', b, u: 'text 14 1', c, v: 'text 14 2', d }; return sink(JSON.stringify(o));");
check("constants 15", function (sink, a, b, c, d) { const l = [a, 'text 15 0', b, 'text 15 1', c, 'text 15 2', d]; return sink(l); }, "const l = [a, 'text 15 0', b, 'text 15 1', c, 'text 15 2', d]; return sink(l);");
check("constants 16", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 17", function (sink, a, b, c, d) { const o = {}; o['key 17 0'] = a; o['key 17 1'] = b; o['key 17 2'] = c; o['key 17 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 17 0'] = a; o['key 17 1'] = b; o['key 17 2'] = c; o['key 17 3'] = d; return sink(JSON.stringify(o));");
check("constants 18", function (sink, a, b, c, d) { return sink(a, 'text 18 0', b, 'text 18 1', c, 'text 18 2', d, 'text 18 3'); }, "return sink(a, 'text 18 0', b, 'text 18 1', c, 'text 18 2', d, 'text 18 3');");
check("constants 19", function (sink, a, b, c, d) { return [sink(a, 'text 19 0'), sink(b, 'text 19 1'), sink(c, 'text 19 2'), sink(d, 'text 19 3')].join(); }, "return [sink(a, 'text 19 0'), sink(b, 'text 19 1'), sink(c, 'text 19 2'), sink(d, 'text 19 3')].join();");
check("constants 20", function (sink, a, b, c, d) { const o = { a, t: 'text 20 0', b, u: 'text 20 1', c, v: 'text 20 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 20 0', b, u: 'text 20 1', c, v: 'text 20 2', d }; return sink(JSON.stringify(o));");
check("constants 21", function (sink, a, b, c, d) { const l = [a, 'text 21 0', b, 'text 21 1', c, 'text 21 2', d]; return sink(l); }, "const l = [a, 'text 21 0', b, 'text 21 1', c, 'text 21 2', d]; return sink(l);");
check("constants 22", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 23", function (sink, a, b, c, d) { const o = {}; o['key 23 0'] = a; o['key 23 1'] = b; o['key 23 2'] = c; o['key 23 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 23 0'] = a; o['key 23 1'] = b; o['key 23 2'] = c; o['key 23 3'] = d; return sink(JSON.stringify(o));");
check("constants 24", function (sink, a, b, c, d) { return sink(a, 'text 24 0', b, 'text 24 1', c, 'text 24 2', d, 'text 24 3'); }, "return sink(a, 'text 24 0', b, 'text 24 1', c, 'text 24 2', d, 'text 24 3');");
check("constants 25", function (sink, a, b, c, d) { return [sink(a, 'text 25 0'), sink(b, 'text 25 1'), sink(c, 'text 25 2'), sink(d, 'text 25 3')].join(); }, "return [sink(a, 'text 25 0'), sink(b, 'text 25 1'), sink(c, 'text 25 2'), sink(d, 'text 25 3')].join();");
check("constants 26", function (sink, a, b, c, d) { const o = { a, t: 'text 26 0', b, u: 'text 26 1', c, v: 'text 26 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 26 0', b, u: 'text 26 1', c, v: 'text 26 2', d }; return sink(JSON.stringify(o));");
check("constants 27", function (sink, a, b, c, d) { const l = [a, 'text 27 0', b, 'text 27 1', c, 'text 27 2', d]; return sink(l); }, "const l = [a, 'text 27 0', b, 'text 27 1', c, 'text 27 2', d]; return sink(l);");
check("constants 28", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 29", function (sink, a, b, c, d) { const o = {}; o['key 29 0'] = a; o['key 29 1'] = b; o['key 29 2'] = c; o['key 29 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 29 0'] = a; o['key 29 1'] = b; o['key 29 2'] = c; o['key 29 3'] = d; return sink(JSON.stringify(o));");
check("constants 30", function (sink, a, b, c, d) { return sink(a, 'text 30 0', b, 'text 30 1', c, 'text 30 2', d, 'text 30 3'); }, "return sink(a, 'text 30 0', b, 'text 30 1', c, 'text 30 2', d, 'text 30 3');");
check("constants 31", function (sink, a, b, c, d) { return [sink(a, 'text 31 0'), sink(b, 'text 31 1'), sink(c, 'text 31 2'), sink(d, 'text 31 3')].join(); }, "return [sink(a, 'text 31 0'), sink(b, 'text 31 1'), sink(c, 'text 31 2'), sink(d, 'text 31 3')].join();");
check("constants 32", function (sink, a, b, c, d) { const o = { a, t: 'text 32 0', b, u: 'text 32 1', c, v: 'text 32 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 32 0', b, u: 'text 32 1', c, v: 'text 32 2', d }; return sink(JSON.stringify(o));");
check("constants 33", function (sink, a, b, c, d) { const l = [a, 'text 33 0', b, 'text 33 1', c, 'text 33 2', d]; return sink(l); }, "const l = [a, 'text 33 0', b, 'text 33 1', c, 'text 33 2', d]; return sink(l);");
check("constants 34", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 35", function (sink, a, b, c, d) { const o = {}; o['key 35 0'] = a; o['key 35 1'] = b; o['key 35 2'] = c; o['key 35 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 35 0'] = a; o['key 35 1'] = b; o['key 35 2'] = c; o['key 35 3'] = d; return sink(JSON.stringify(o));");
check("constants 36", function (sink, a, b, c, d) { return sink(a, 'text 36 0', b, 'text 36 1', c, 'text 36 2', d, 'text 36 3'); }, "return sink(a, 'text 36 0', b, 'text 36 1', c, 'text 36 2', d, 'text 36 3');");
check("constants 37", function (sink, a, b, c, d) { return [sink(a, 'text 37 0'), sink(b, 'text 37 1'), sink(c, 'text 37 2'), sink(d, 'text 37 3')].join(); }, "return [sink(a, 'text 37 0'), sink(b, 'text 37 1'), sink(c, 'text 37 2'), sink(d, 'text 37 3')].join();");
check("constants 38", function (sink, a, b, c, d) { const o = { a, t: 'text 38 0', b, u: 'text 38 1', c, v: 'text 38 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 38 0', b, u: 'text 38 1', c, v: 'text 38 2', d }; return sink(JSON.stringify(o));");
check("constants 39", function (sink, a, b, c, d) { const l = [a, 'text 39 0', b, 'text 39 1', c, 'text 39 2', d]; return sink(l); }, "const l = [a, 'text 39 0', b, 'text 39 1', c, 'text 39 2', d]; return sink(l);");
check("constants 40", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 41", function (sink, a, b, c, d) { const o = {}; o['key 41 0'] = a; o['key 41 1'] = b; o['key 41 2'] = c; o['key 41 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 41 0'] = a; o['key 41 1'] = b; o['key 41 2'] = c; o['key 41 3'] = d; return sink(JSON.stringify(o));");
check("constants 42", function (sink, a, b, c, d) { return sink(a, 'text 42 0', b, 'text 42 1', c, 'text 42 2', d, 'text 42 3'); }, "return sink(a, 'text 42 0', b, 'text 42 1', c, 'text 42 2', d, 'text 42 3');");
check("constants 43", function (sink, a, b, c, d) { return [sink(a, 'text 43 0'), sink(b, 'text 43 1'), sink(c, 'text 43 2'), sink(d, 'text 43 3')].join(); }, "return [sink(a, 'text 43 0'), sink(b, 'text 43 1'), sink(c, 'text 43 2'), sink(d, 'text 43 3')].join();");
check("constants 44", function (sink, a, b, c, d) { const o = { a, t: 'text 44 0', b, u: 'text 44 1', c, v: 'text 44 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 44 0', b, u: 'text 44 1', c, v: 'text 44 2', d }; return sink(JSON.stringify(o));");
check("constants 45", function (sink, a, b, c, d) { const l = [a, 'text 45 0', b, 'text 45 1', c, 'text 45 2', d]; return sink(l); }, "const l = [a, 'text 45 0', b, 'text 45 1', c, 'text 45 2', d]; return sink(l);");
check("constants 46", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 47", function (sink, a, b, c, d) { const o = {}; o['key 47 0'] = a; o['key 47 1'] = b; o['key 47 2'] = c; o['key 47 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 47 0'] = a; o['key 47 1'] = b; o['key 47 2'] = c; o['key 47 3'] = d; return sink(JSON.stringify(o));");
check("constants 48", function (sink, a, b, c, d) { return sink(a, 'text 48 0', b, 'text 48 1', c, 'text 48 2', d, 'text 48 3'); }, "return sink(a, 'text 48 0', b, 'text 48 1', c, 'text 48 2', d, 'text 48 3');");
check("constants 49", function (sink, a, b, c, d) { return [sink(a, 'text 49 0'), sink(b, 'text 49 1'), sink(c, 'text 49 2'), sink(d, 'text 49 3')].join(); }, "return [sink(a, 'text 49 0'), sink(b, 'text 49 1'), sink(c, 'text 49 2'), sink(d, 'text 49 3')].join();");
check("constants 50", function (sink, a, b, c, d) { const o = { a, t: 'text 50 0', b, u: 'text 50 1', c, v: 'text 50 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 50 0', b, u: 'text 50 1', c, v: 'text 50 2', d }; return sink(JSON.stringify(o));");
check("constants 51", function (sink, a, b, c, d) { const l = [a, 'text 51 0', b, 'text 51 1', c, 'text 51 2', d]; return sink(l); }, "const l = [a, 'text 51 0', b, 'text 51 1', c, 'text 51 2', d]; return sink(l);");
check("constants 52", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 53", function (sink, a, b, c, d) { const o = {}; o['key 53 0'] = a; o['key 53 1'] = b; o['key 53 2'] = c; o['key 53 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 53 0'] = a; o['key 53 1'] = b; o['key 53 2'] = c; o['key 53 3'] = d; return sink(JSON.stringify(o));");
check("constants 54", function (sink, a, b, c, d) { return sink(a, 'text 54 0', b, 'text 54 1', c, 'text 54 2', d, 'text 54 3'); }, "return sink(a, 'text 54 0', b, 'text 54 1', c, 'text 54 2', d, 'text 54 3');");
check("constants 55", function (sink, a, b, c, d) { return [sink(a, 'text 55 0'), sink(b, 'text 55 1'), sink(c, 'text 55 2'), sink(d, 'text 55 3')].join(); }, "return [sink(a, 'text 55 0'), sink(b, 'text 55 1'), sink(c, 'text 55 2'), sink(d, 'text 55 3')].join();");
check("constants 56", function (sink, a, b, c, d) { const o = { a, t: 'text 56 0', b, u: 'text 56 1', c, v: 'text 56 2', d }; return sink(JSON.stringify(o)); }, "const o = { a, t: 'text 56 0', b, u: 'text 56 1', c, v: 'text 56 2', d }; return sink(JSON.stringify(o));");
check("constants 57", function (sink, a, b, c, d) { const l = [a, 'text 57 0', b, 'text 57 1', c, 'text 57 2', d]; return sink(l); }, "const l = [a, 'text 57 0', b, 'text 57 1', c, 'text 57 2', d]; return sink(l);");
check("constants 58", function (sink, a, b, c, d) { return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator); }, "return sink(a, Math, b, JSON, c, Reflect, d, Symbol.iterator);");
check("constants 59", function (sink, a, b, c, d) { const o = {}; o['key 59 0'] = a; o['key 59 1'] = b; o['key 59 2'] = c; o['key 59 3'] = d; return sink(JSON.stringify(o)); }, "const o = {}; o['key 59 0'] = a; o['key 59 1'] = b; o['key 59 2'] = c; o['key 59 3'] = d; return sink(JSON.stringify(o));");
console.log(cases, "cases,", wrongCases, "wrong");
