// A closure is made, asked something (typeof, a comparison, instanceof, a member, a call), and then leaves the function that made it:
// returned, stored, thrown, yielded, captured by another closure or handed to a call, under the name that was asked or under a second
// name for it. It stays one and the same function. A program draws one question and one way out and runs them for six kinds of closure,
// four hundred times each: it counts the functions it got, puts a mark on each and calls some.
import type { Random } from "./random";

const questions = [
  "typeof f === 'function'",
  "typeof f !== 'object'",
  "f",
  "f !== null",
  "f !== undefined",
  "f != null",
  "f === other",
  "f !== other",
  "f === alias",
  "f instanceof Function",
  "'call' in f",
  "f.length === 0",
  "f?.() !== undefined",
  "Object.is(f, alias)",
  "(k % 7 === 3 ? typeof f === 'function' : f !== other)",
  "k === 250 && typeof f === 'function'",
];

const waysOut = [
  "if (ASKED) return f; return alias;",
  "if (ASKED) return f; return null;",
  "return ASKED ? f : alias;",
  "return (ASKED) && f;",
  "return (!(ASKED) && 0) || f;",
  "if (ASKED) sink.push(f); else sink.push(alias); return sink[sink.length - 1];",
  "const o = { g: null, h: alias }; if (ASKED) o.g = f; return o.g || o.h;",
  "function C() { this.x = x; if (ASKED) return f; } return new C();",
  "for (let i = 0; i < 3; i++) { if (i === 1 && (ASKED)) return f; } return alias;",
  "try { if (ASKED) return f; } finally { x++; } return alias;",
  "try { if (ASKED) throw f; } catch (e) { return e; } return alias;",
  "const g = () => f; if (ASKED) return g(); return alias;",
  "if (ASKED) return keep(f); return keep(alias);",
  "function* y() { if (ASKED) yield f; yield alias; } return y().next().value;",
  "if (ASKED) return pair(f, alias); return pair(alias, f);",
];

const kinds = {
  arrow: "const f = () => x + k;",
  expression: "const f = function () { return x + k; };",
  declaration: "function f() { return x + k; }",
  method: "const f = { m() { return x + k; } }.m;",
  asyncArrow: "const f = async () => x + k;",
  boundLater: "const f = () => x + k; const spare = f.bind(null);",
};

export function generate(random: Random): string {
  const wayOut = random.pick(waysOut).replaceAll("ASKED", random.pick(questions));
  const makers = Object.entries(kinds).map(
    ([kind, closure]) => `function ${kind}(k, other) { let x = k * 2; ${closure} const alias = f; ${wayOut} }`,
  );
  return `const sink = [];
function keep(v) { sink.push(v); return v; }
function pair(a, b) { const r = function () { return a(); }; r.same = a === b; r.a = a; r.b = b; return r; }
${makers.join("\n")}
async function value(v) {
  if (typeof v !== "function") return typeof v + ":" + JSON.stringify(v);
  let r = v();
  if (r && typeof r.then === "function") r = "async " + (await r);
  return r;
}
for (const make of [${Object.keys(kinds).join(", ")}]) {
  const seen = new Set();
  const lines = [];
  const stranger = () => -1;
  for (let k = 0; k < 400; k++) {
    const a = make(k, k % 5 ? stranger : null);
    seen.add(a);
    if (typeof a === "function") {
      a.mark = k;
      if (a.mark !== k) lines.push("mark lost at " + k);
      if ("same" in a && (a.same !== true || a.a !== a.b)) lines.push("two functions at " + k);
    }
    if (k % 97 === 0 || k === 250) lines.push(k + "=" + (await value(a)));
  }
  console.log(make.name, seen.size, lines.join(" "), sink.length, new Set(sink).size);
  sink.length = 0;
}
`;
}
