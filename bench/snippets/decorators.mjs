// Standard decorators and `accessor` members: what a class costs to define, to
// construct and to use. Bun lowers both, so this measures the code that the
// lowering prints. Node cannot parse the syntax.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bench, group, run } from "../runner.mjs";

const kinds = {
  "#x, no decorator": { member: i => `#a${i} = ${i};`, use: i => `this.#a${i} = this.#a${i} + v; return this.#a${i};` },
  "@dec #x": { member: i => `@dec #a${i} = ${i};`, use: i => `this.#a${i} = this.#a${i} + v; return this.#a${i};` },
  "@dec #m()": { member: i => `@dec #a${i}() { return ${i}; }`, use: i => `return this.#a${i}() + v;` },
  "@dec accessor #x": {
    member: i => `@dec accessor #a${i} = ${i};`,
    use: i => `this.#a${i} = this.#a${i} + v; return this.#a${i};`,
  },
  "@dec accessor x": {
    member: i => `@dec accessor a${i} = ${i};`,
    use: i => `this.a${i} = this.a${i} + v; return this.a${i};`,
  },
  "accessor x": { member: i => `accessor a${i} = ${i};`, use: i => `this.a${i} = this.a${i} + v; return this.a${i};` },
};
const memberCounts = [1, 10, 100];
// A mixin that is applied to this many classes evaluates its class that often.
const evaluationCounts = [1, 8, 32];
const usesPerRound = 32;

// What each bench runs, as the default export of a module of its own. The
// functions of a class expression are shared by every evaluation of it, and
// so are their inline caches: no bench may share code with another one.
const benches = {
  define: () => `export default make;`,
  new: () => `const A = make(); let last; export default () => { last = new A(); };`,
  use: () => `const object = new (make())(); export default () => object.use(1);`,
  round: evaluationCount => `
const objects = Array.from({ length: ${evaluationCount} }, () => new (make())());
const round = Array.from({ length: ${usesPerRound} }, (_, i) => objects[i % objects.length]);
export default () => { for (let i = 0; i < round.length; i++) round[i].use(1); };`,
};

const dir = mkdtempSync(join(tmpdir(), "bench-decorators-"));
let files = 0;

async function load(kind, memberCount, what, argument) {
  const { member, use } = kinds[kind];
  const file = join(dir, `class-${files++}.mjs`);
  writeFileSync(
    file,
    `const dec = (value, context) => {};
const make = () => class {
  ${Array.from({ length: memberCount }, (_, i) => member(i)).join("\n  ")}
  use(v) { ${use(memberCount - 1)} }
};
${benches[what](argument)}
`,
  );
  return (await import(file)).default;
}

for (const kind of Object.keys(kinds)) {
  for (const memberCount of memberCounts) {
    const define = await load(kind, memberCount, "define");
    const construct = await load(kind, memberCount, "new");
    const use = await load(kind, memberCount, "use");
    group(`${kind}, ${memberCount} members`, () => {
      bench(`define: ${kind} x ${memberCount}`, define);
      bench(`new: ${kind} x ${memberCount}`, construct);
      bench(`read and write: ${kind} x ${memberCount}`, use);
    });
  }

  // The objects of each round come from this many evaluations of one class expression.
  const rounds = [];
  for (const evaluationCount of evaluationCounts) {
    rounds.push([evaluationCount, await load(kind, 1, "round", evaluationCount)]);
  }
  group(`${kind}, ${usesPerRound} reads and writes`, () => {
    for (const [evaluationCount, round] of rounds) {
      bench(`${evaluationCount} evaluations of the class: ${kind}`, round);
    }
  });
}

await run();
