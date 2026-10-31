// A function returns one of a few object literals that share a tag: `{ ok: true, value }` or `{ ok: false, error }`. Where
// the caller only branches on the tag and reads the fields, the compiler need not make the objects at all. Each scene picks
// the literals (2 to 4; a boolean, string or number tag; the same or another key order; a shared field that holds another
// type in each), how the result travels (straight, through a second function, out of a loop or a try block) and what the
// caller does besides: keeps, returns, spreads, prints or changes the object before or after the branch, or compares two.
import type { Random } from "./random";

/** Families of literals. Each entry is one arm of the maker. `n` is the maker's argument. */
const families: string[][] = [
  ["{ ok: true, value: n }", '{ ok: false, error: "bad " + n }'],
  ["{ ok: true, value: n }", "{ ok: false, value: String(n) }"],
  ["{ ok: true, value: n }", "{ value: n + 0.5, ok: false }"],
  ["{ ok: true, value: n, extra: 1 }", "{ ok: false, value: undefined }"],
  ['{ kind: "a", x: n }', '{ kind: "b", x: "text", y: n }', '{ kind: "c" }'],
  ["{ tag: 0, x: n }", "{ tag: 1, x: n * 0.5 }", "{ tag: 2, x: { deep: n } }", "{ tag: 3, x: null }"],
  ["{ ok: true, value: [n] }", "{ ok: false, value: [] }"],
  ["{ ok: true, value: () => n }", "{ ok: false, value: null }"],
  ["{ ok: n > 1, value: n }", "{ ok: false, error: n }"],
  ["{ ok: true, value: n }", "null"],
  ["{ ok: true, value: n }", "shared"],
  ["{ done: false, value: n }", "{ done: true, value: undefined }"],
];

/** Bodies of the caller. `r` is the result. TAG is the name of the tag. */
const callers = [
  'return r.TAG ? "yes " + r.value : "no " + r.error;',
  'if (r.TAG) return "yes " + r.value;\n  return "no " + r.error + "," + r.value;',
  'const first = r.TAG;\n  return first + ":" + r.value + ":" + r.x;',
  'switch (r.TAG) {\n    case true:\n    case "a":\n    case 0:\n      return "first " + (r.value ?? r.x);\n    case "b":\n    case 1:\n      return "second " + r.x + "," + r.y;\n    default:\n      return "other " + r.x + "," + r.error;\n  }',
  "kept.push(r);\n  return r.TAG ? r.value : r.error;",
  "if (r.TAG) kept.push(r);\n  return String(r.value);",
  "const answer = r.TAG ? r.value : r.error;\n  kept.push(r);\n  return answer;",
  "return JSON.stringify(r);",
  'return r.TAG ? JSON.stringify(r) : "no";',
  "return Object.keys({ ...r }).join() + r.TAG;",
  "return Object.keys(r).join();",
  "r.value = 99;\n  return r.TAG ? r.value : r.error;",
  'if (r.TAG) r.value = 99;\n  return r.value + "," + Object.keys(r).join();',
  'r.TAG = !r.TAG;\n  return r.TAG ? "yes " + r.value : "no " + r.error;',
  "r.added = 1;\n  return Object.keys(r).join();",
  'delete r.value;\n  return r.TAG + "," + ("value" in r);',
  'const { TAG: tag, value = "none", ...rest } = r;\n  return tag + "," + value + "," + Object.keys(rest).join();',
  "return r;",
  'return r.TAG ? r : "no";',
  'return (r === again) + "," + (r.TAG === again.TAG);',
  'return typeof r.value + "," + typeof r.x + "," + typeof r.error;',
  'return typeof r.value === "function" ? r.value() : Array.isArray(r.value) ? r.value.length : r.value;',
  'let sum = 0;\n  for (let i = 0; i < 3; i++) sum += r.TAG ? 1 : 2;\n  return sum + "," + r.value;',
  'try {\n    if (!r.TAG) throw r;\n    return "fine " + r.value;\n  } catch (thrown) {\n    return "thrown " + (thrown === r) + "," + thrown.error;\n  }',
  'return Object.getPrototypeOf(r) === Object.prototype && r.hasOwnProperty("TAG");',
  "return unknown(r);",
  "return r?.TAG ? r.value : r?.error;",
];

/** How the result comes to the caller. MAKE(n) is the maker. */
const routes = [
  "const r = MAKE(n);",
  "const r = MAKE(n);",
  "const r = through(MAKE, n);",
  "const r = (() => MAKE(n))();",
  "let r = MAKE(n);\n  for (let i = 0; i < 2; i++) r = MAKE(n + i);",
  "let r;\n  try {\n    r = MAKE(n);\n  } catch {\n    r = MAKE(0);\n  }",
  "const r = n > 2 ? MAKE(n) : MAKE(n + 1);",
  "const [r] = [MAKE(n)];",
  "const r = [MAKE(n), MAKE(n + 1)][n & 1];",
  "const r = await later(MAKE(n));",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const family = random.pick(families);
    const tag = /^\{ (\w+):/.exec(family[0])![1];
    const arms = random.shuffled(family);
    const maker = `function make${scene}(n) {
  ${arms
    .slice(0, -1)
    .map((arm, at) => `if (n % ${arms.length} === ${at}) return ${arm};`)
    .join("\n  ")}
  return ${arms.at(-1)};
}`;
    const route = random.pick(routes).replaceAll("MAKE", `make${scene}`);
    const isAsync = route.includes("await");
    scenes.push(`${maker}
${isAsync ? "async " : ""}function use${scene}(n) {
  ${route}
  const again = make${scene}(n);
  ${random.pick(callers).replaceAll("TAG", tag)}
}
{
  let last;
  for (let round = 0; round < ${random.pick([1, 1, 3, 300])}; round++) {
    kept.length = 0;
    const answers = [];
    for (let n = 0; n < 5; n++) {
      try {
        answers.push(shown(${isAsync ? "await " : ""}use${scene}(n)));
      } catch (error) {
        answers.push("threw " + error.name);
      }
    }
    last = noted(answers.join(" | ") + " kept " + kept.map(each => shown(each)).join(";"));
  }
  console.log("scene ${scene}", last, counted());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set();
function noted(answer) {
  rounds.add(answer);
  return answer;
}
function counted() {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const kept = [];
const shared = { ok: false, error: "shared" };
const through = (make, n) => make(n);
const later = async value => value;
const ways = [r => r.value, r => Object.keys(r).length, r => ((r.seen = true), r.ok)];
let turn = 0;
const unknown = r => ways[turn++ % ways.length](r);
function shown(value, depth = 0) {
  if (typeof value === "function") return "function " + value();
  if (value === null || typeof value !== "object") return Object.is(value, -0) ? "-0" : String(value);
  if (depth > 2) return "deep";
  return (Array.isArray(value) ? "[" : "{") + Object.keys(value).map(name => name + ":" + shown(value[name], depth + 1)).join() + "}";
}
${scenes.join("\n")}
`;
}
