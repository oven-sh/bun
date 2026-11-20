// `catch (error) { await note(error.message); text = undefined; }`: a coroutine sets a variable to undefined or null behind an await or
// a yield. A compiler may take that for the end of the value's life and stop keeping it across the suspensions that follow; where it
// says so matters most in a catch or a finally block, whose first operation is fixed. Each scene draws the kind of coroutine, what its
// variables hold and who else sees them (a closure, a parameter), and a body of nested try blocks, loops, branches and switches in which
// suspensions, the letting go, new values, reads, throws and early exits stand in every order. Generators are also resumed with throw()
// and return(), which enter the handlers from outside.
import type { Random } from "./random";

const kinds = ["async function", "async function", "function*", "function*", "async function*"] as const;
const contents = ["{ held: K }", "[K, K + 1]", '"text" + K', "K", "K + 0.5", "() => K", "new Map([[K, K]])", "make(K)"];
const nothings = ["undefined", "undefined", "undefined", "null", "null", "void 0"];

export function generate(random: Random): string {
  const scenes: string[] = [];
  const drives: string[] = [];
  let key = 1;
  const count = random.between(1, 3);
  for (let scene = 0; scene < count; scene++) {
    const kind = random.pick(kinds);
    const isAsync = kind.startsWith("async");
    const isGenerator = kind.endsWith("*");
    const names = Array.from({ length: random.between(1, 4) }, (_, at) => `v${at}`);
    if (random.chance(0.4)) names.push("given");
    const pause = () =>
      isGenerator && (!isAsync || random.chance(0.6))
        ? random.pick([`yield ${key++};`, `note("sent", yield ${key++});`])
        : random.pick([`await tick(${key++});`, `note("awaited", await tick(${key++}));`, "await null;"]);
    const letGo = () => `${random.pick(names)} = ${random.pick(nothings)};`;
    const simple = (): string =>
      random.pick([
        pause,
        pause,
        letGo,
        letGo,
        () => `${random.pick(names)} = ${random.pick(contents).replaceAll("K", String(key++))};`,
        () => `note("${random.pick(names)}", ${random.pick(names)});`,
        () => `fail(${key++});`,
        () => `note("seen", look());`,
      ])();
    /** What stands first in a handler is what matters: most handlers suspend and then let go. */
    const handler = (depth: number) =>
      random.chance(0.6) ? [pause(), letGo(), ...(random.chance(0.5) ? [block(depth)] : [])].join("\n") : block(depth);
    const block = (depth: number): string =>
      Array.from({ length: random.between(1, 3) }, () => {
        if (depth <= 0 || random.chance(0.45)) return simple();
        const inner = () => block(depth - 1);
        return random.pick([
          () => `try {\n${inner()}\n} catch (error) {\nnote("caught", error.message);\n${handler(depth - 1)}\n}`,
          () => `try {\n${inner()}\n} catch (error) {\n${handler(depth - 1)}\nnote("caught", error.message);\n}`,
          () => `try {\n${inner()}\n} catch {\n${handler(depth - 1)}\n}`,
          () => `try {\n${inner()}\n} finally {\n${handler(depth - 1)}\n}`,
          () => `try {\n${inner()}\n} catch (error) {\n${handler(depth - 1)}\n} finally {\n${handler(depth - 1)}\n}`,
          () =>
            `for (let turn = 0; turn < ${random.between(1, 3)}; turn++) {\n${inner()}\n${random.chance(0.2) ? "if (turn) break;" : ""}\n}`,
          () => `if (choose(${key++})) {\n${inner()}\n} else {\n${inner()}\n}`,
          () =>
            `switch (choose(${key++}) ? 0 : 1) {\ncase 0:\n${inner()}\n${random.chance(0.7) ? "break;" : ""}\ndefault:\n${inner()}\n}`,
          () =>
            `try {\n${inner()}\n${random.chance(0.5) ? `return note("early", ${random.pick(names)});` : `fail(${key++});`}\n} finally {\n${handler(depth - 1)}\n}`,
        ])();
      }).join("\n");
    const declared = names
      .filter(name => name !== "given")
      .map(
        name =>
          `${random.pick(["let", "let", "var"])} ${name} = ${random.pick(contents).replaceAll("K", String(key++))};`,
      );
    scenes.push(`${kind} run${scene}(given) {
${declared.join("\n")}
const look = () => ${random.chance(0.5) ? random.pick(names) : "0"};
${block(3)}
return note("end", ${names.join(", ")});
}`);
    const step = isAsync ? "await " : "";
    const resumed = isGenerator
      ? `const it = run${scene}(make(${key++}));
    for (let at = 0; at < 40; at++) {
      const answer = ${step}(at === thrownAt ? it.throw(new Error("from outside")) : at === returnedAt ? it.return("returned") : it.next(at));
      note("step", answer.value, answer.done);
      if (answer.done) break;
    }`
      : `note("answer", await run${scene}(make(${key++})));`;
    drives.push(`for (const [failing, thrownAt, returnedAt] of [[0, -1, -1], [1, -1, -1], [2, ${random.below(4)}, -1], [3, -1, ${random.below(5)}], [1, ${random.between(1, 5)}, ${random.between(2, 7)}]]) {
  calls = 0;
  every = failing;
  try {
    ${resumed}
  } catch (error) {
    note("thrown", error.message);
  }
  console.log("${scene}", failing, lines.splice(0).join(" ; "));
}`);
  }
  return `const lines = [];
let calls = 0;
let every = 0;
function show(value) {
  if (typeof value === "function") return "function " + show(value());
  if (value instanceof Map) return "Map " + JSON.stringify([...value]);
  return value === undefined ? "undefined" : JSON.stringify(value);
}
function note(label, ...values) {
  lines.push(label + " " + values.map(show).join(","));
  return values[0];
}
function make(value) {
  return { made: value };
}
function tick(value) {
  return Promise.resolve(value);
}
function choose(value) {
  return (value + calls++) % 2 === 0;
}
function fail(value) {
  if (every && ++calls % every === 0) throw new Error("failed " + value);
}
${scenes.join("\n")}
async function main() {
${drives.join("\n")}
}
main().then(
  () => console.log("done"),
  error => console.log("failed", error.message),
);
`;
}
