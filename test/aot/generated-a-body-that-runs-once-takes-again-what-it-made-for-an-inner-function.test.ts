// A body that runs once makes a value, hands it to an inner function and takes it again itself: it returns it behind a try, a branch, a label, a switch or a loop, reads it in a
// handler or a finally, or disposes of it. And loops whose start value, condition, update or body holds a try, in a function called on the spot or in a named one, with a declaration
// that nobody calls in the catch or the finally, under conditions that fold. The function that all of them call throws at its first call, at its second, or never.
// A program prints what it prints in plain Bun.
import { generated } from "./generated/run-generated";

const head = `let budget = 0;
let calls = 0;
function note(trace: unknown[], value: unknown): number {
  calls++;
  trace.push(typeof value === "function" ? "function" : value);
  if (budget && calls === budget) throw new Error("note " + calls);
  return calls;
}
function isNever<T>(value: unknown): value is T { return false; }
function passThroughFalsePredicate<T>(value: T | string): T {
  if (isNever<string>(value)) return value.length as unknown as T;
  return value as T;
}
function make(seed: number): { a: number } { return { a: seed }; }
class Point { constructor(public x: number, public y: number) {} }
function show(name: string, trace: unknown[], result: unknown): void { console.log(name, JSON.stringify(trace), JSON.stringify(result)); }
`;
const unused = "function unused(value: undefined): void { try {} catch (error) {} }";
const limits = [0, 1, 2];

const makers = {
  "a call": "make(1)",
  "a call of a generic function": "passThroughFalsePredicate<0 | 1>(0 as any)",
  "an instance": "new Point(1, 2)",
  "a list": "[make(1), make(2)]",
  "a literal": '{ a: make(1), b: [1, 2, 3], c: { d: "x" } }',
  "a map": "new Map([[1, make(1)]])",
  "a frozen object": "Object.freeze({ a: make(2) })",
  "a text": '[make(1).a, "x"].join("-")',
};

const takers = {
  "returned behind a catch": 'try { note(trace, read()); } catch (error) { trace.push("caught"); } return held;',
  "returned behind an empty catch": "try { note(trace, read()); } catch (error) {} return held;",
  "returned behind a finally": 'try { note(trace, read()); } finally { trace.push("finally"); } return held;',
  "returned behind a branch": 'if (note(trace, read) > 0) trace.push("yes"); else trace.push("no"); return held;',
  "what a variable holds first, read in a handler":
    'let last: unknown = held; try { note(trace, read); last = 2; note(trace, read); } catch (error) { trace.push("caught", last === held); } return 0;',
  "what a variable holds last, read in a handler":
    'let last: unknown = 2; try { note(trace, read); last = held; note(trace, read); } catch (error) { trace.push("caught", last === held); } return 0;',
  "read in the handler of the return, which throws":
    'try { return note(trace, read); } catch (error) { throw new Error("wrapped " + JSON.stringify(held)); }',
  "held by a resource":
    'using resource = { held, [Symbol.dispose]() { trace.push("disposed"); } }; note(trace, read); return held;',
  "read in the finally of the return": "try { return note(trace, read); } finally { trace.push(held === read()); }",
  "returned behind a label": 'out: { if (note(trace, read) > 1) break out; trace.push("in"); } return held;',
  "returned behind a switch":
    'switch (note(trace, read)) { case 1: trace.push("one"); break; case 2: trace.push("two"); break; default: break; } return held;',
  "returned behind a loop": "for (let i = 0; i < 2; i++) note(trace, read); return held;",
  "returned or not": "return note(trace, read) > 1 ? held : null;",
  "returned unless it is nullish": 'note(trace, read); return held ?? "none";',
  "returned in the catch too": "try { note(trace, read); } catch (error) { return held; } return held;",
  "returned in a list":
    'try { try { note(trace, read); } finally { trace.push("inner"); } } catch (error) { trace.push("outer"); } return [held, held];',
  "returned behind a loop with a try":
    "while (note(trace, read) < 2) { try { note(trace, read()); } catch (error) { break; } } return held;",
  "returned behind a declaration in a catch": `try { note(trace, read); } catch (error) { ${unused} } return held;`,
  "not taken": 'try { note(trace, read); } catch (error) { trace.push("caught"); } return 0;',
};

const leavesByLabel = (text: string) => text.replace(/return ([^;]*);/g, "{ result = $1; break body; }");
const bodies: Record<string, (inner: string, number: number, taker: string) => string | undefined> = {
  "a function called on the spot": inner => `result = (() => { ${inner} })();`,
  "a function called once": (inner, number) => `function once${number}() { ${inner} } result = once${number}();`,
  "a method called once": inner => `result = { run() { ${inner} } }.run();`,
  "the module": inner => `body: { ${leavesByLabel(inner)} }`,
  "a static block": (inner, number, taker) =>
    taker === "returned in the catch too" || taker === "returned behind a label"
      ? undefined
      : `class Holder${number} { static { ${inner.replaceAll("return ", "result = ")} } }`,
  "an async function called on the spot": inner => `result = await (async () => { ${inner} })();`,
};

function writeBody(body: string, made: string) {
  const cases: string[] = [];
  for (const [taker, takes] of Object.entries(takers))
    for (const limit of limits) {
      const run = bodies[body](`const held = ${made}; const read = () => held; ${takes}`, cases.length, taker);
      if (run)
        cases.push(`{
  const trace: unknown[] = [];
  calls = 0;
  budget = ${limit};
  let result: unknown;
  try { ${run} } catch (error) { result = "thrown " + (error as Error).message; }
  show(${JSON.stringify(`${taker} ${limit}`)}, trace, result);
}`);
    }
  return { file: "main.ts", text: `${head}${cases.join("\n")}\n` };
}

const guards: Record<string, (statement: string) => string> = {
  "no declaration": statement => `try { ${statement} } catch (error) { trace.push("caught"); }`,
  "a declaration in the catch": statement => `try { ${statement} } catch (error) { ${unused} }`,
  "a declaration in the finally": statement => `try { ${statement} } finally { ${unused} }`,
};
const placesOfLoops: Record<string, string[]> = {
  "for": ["around", "start", "condition", "update", "body", "start and condition"],
  "while": ["around", "condition", "body"],
  "do": ["around", "condition", "body"],
  "for..of": ["around", "start", "condition", "body", "start and condition"],
  "for..in": ["around", "start", "condition", "body", "start and condition"],
};

function writeLoop(loop: string, place: string, isCalledOnTheSpot: boolean) {
  const cases: string[] = [];
  for (const [declaration, guard] of Object.entries(guards))
    for (const fold of ["false", "true", "open"])
      for (const limit of limits) {
        const helpers: string[] = [];
        const isHeldInside = isCalledOnTheSpot && place.includes("start");
        const subject = isHeldInside ? "start" : "held";
        const held = "const held: 0 | 1 = passThroughFalsePredicate<0 | 1>(0 as any);";
        const part = (label: string, value: string, hasTry: boolean, before = "") => {
          const statement = `note(trace, (() => ${label === "condition" ? "{}" : label === "start" ? "held" : subject})());`;
          const statements = `${before}${hasTry ? guard(statement) : statement} return ${value};`;
          if (isCalledOnTheSpot) return `(() => { ${statements} })()`;
          helpers.push(`function ${label}Part() { ${statements} }`);
          return `${label}Part()`;
        };
        const folded = {
          false: `isNever<string>(${subject})`,
          true: `!isNever<string>(${subject})`,
          open: "turns < 2",
        }[fold];
        const first =
          { "for": "held as any", "for..of": "[held, 1, 2]", "for..in": "{ a: held, b: 1, c: 2 }" }[loop] ?? "held";
        const start = part("start", first, place.includes("start"), isHeldInside ? `${held} ` : "");
        const condition = part("condition", `${folded} && ++turns < 4`, place.includes("condition"));
        const update = part("update", "turns", place === "update");
        const body = `${part("body", "turns", place === "body")};`;
        let text = {
          "for": place.includes("start")
            ? `for (let start: any = ${start}; ${condition}; ${update}) { ${body} }`
            : `const start: any = ${start}; for (let i = start; ${condition}; ${update}) { ${body} }`,
          "while": `const start: any = ${start}; while (${condition}) { ${body} }`,
          "do": `const start: any = ${start}; do { ${body} } while (${condition});`,
          "for..of": `const start: any = ${start}; for (const element of start) { if (!(${condition})) break; ${body} }`,
          "for..in": `const start: any = ${start}; for (const key in start) { if (!(${condition})) break; ${body} }`,
        }[loop]!;
        if (place === "around") text = guard(text);
        cases.push(`{
  const trace: unknown[] = [];
  let turns = 0;
  calls = 0;
  budget = ${limit};
  ${isHeldInside ? "" : held}
  ${helpers.join("\n  ")}
  try { ${text} } catch (error) { trace.push("outer", (error as Error).message); }
  show(${JSON.stringify(`${declaration} ${fold} ${limit}`)}, trace, turns);
}`);
      }
  return { file: "main.ts", text: `${head}${cases.join("\n")}\n` };
}

const bodiesInEveryRun = [
  "a function called on the spot",
  "a function called once",
  "a method called once",
  "a static block",
];

generated("a body that runs once takes again what it made for an inner function as in plain Bun", [
  ...Object.keys(bodies).flatMap(body =>
    Object.entries(makers).map(([maker, made]) => ({
      name: `${body} makes ${maker}.`,
      isAlwaysRun: false,
      wasOnceWrong: bodiesInEveryRun.includes(body) && maker === "a call",
      isOnlyCompiled: true as const,
      make: () => writeBody(body, made),
    })),
  ),
  ...Object.entries(placesOfLoops).flatMap(([loop, places]) =>
    places.flatMap(place =>
      [true, false].map(isCalledOnTheSpot => ({
        name: `${loop} with a try ${place === "around" ? "around it" : `in its ${place}`}, in ${isCalledOnTheSpot ? "functions called on the spot" : "named functions"}.`,
        isAlwaysRun: false,
        wasOnceWrong: loop === "for" && place.includes("start") && isCalledOnTheSpot,
        isOnlyCompiled: true as const,
        make: () => writeLoop(loop, place, isCalledOnTheSpot),
      })),
    ),
  ),
]);
