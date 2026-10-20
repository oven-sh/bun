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
// What a decorator does with `context.access` of a member. `access` and `o` belong to one evaluation of the class.
const accessKinds = {
  "@dec #x": { member: "@keep #a = 1;", use: "access.has(o) && access.set(o, access.get(o) + 1);" },
  "@dec #m()": { member: "@keep #a() { return 1; }", use: "access.has(o) && access.get(o);" },
  "@dec accessor #x": { member: "@keep accessor #a = 1;", use: "access.has(o) && access.set(o, access.get(o) + 1);" },
  "@dec x": { member: "@keep a = 1;", use: "access.has(o) && access.set(o, access.get(o) + 1);" },
};
const memberCounts = [1, 10, 100];
// The engine caches a `#private` access for 8 kinds of object. A mixin that is
// applied to N classes, and a class with N subclasses, both give it N kinds.
const kindsOfObject = [1, 8, 9, 16, 32];
const usesPerRound = 32;
const evaluationsPerCall = 64;

// What each bench runs, as the default export of a module of its own. The
// functions of a class expression are shared by every evaluation of it, and
// so are their inline caches: no bench may share code with another one.
const benches = {
  // A fixed loop, so that the runner measures every kind in the same mode.
  define: () => `
for (let i = 0; i < 1000; i++) make();
export default () => { for (let i = 0; i < ${evaluationsPerCall}; i++) make(); };`,
  mixin: () => `
for (let i = 0; i < 1000; i++) new (make())().use(1);
export default () => { for (let i = 0; i < ${evaluationsPerCall}; i++) new (make())().use(1); };`,
  new: () => `const A = make(); let last; export default () => { last = new A(); };`,
  use: () => `const object = new (make())(); export default () => object.use(1);`,
  evaluations: count => `
const objects = Array.from({ length: ${count} }, () => new (make())());
const round = Array.from({ length: ${usesPerRound} }, (_, i) => objects[i % objects.length]);
export default () => { for (let i = 0; i < round.length; i++) round[i].use(1); };`,
  subclasses: count => `
const Base = make();
const objects = Array.from({ length: ${count} }, () => new (class extends Base {})());
const round = Array.from({ length: ${usesPerRound} }, (_, i) => objects[i % objects.length]);
export default () => { for (let i = 0; i < round.length; i++) round[i].use(1); };`,
};

const dir = mkdtempSync(join(tmpdir(), "bench-decorators-"));
let files = 0;

async function loadAccess(kind, count) {
  const { member, use } = accessKinds[kind];
  const file = join(dir, `class-${files++}.mjs`);
  writeFileSync(
    file,
    `const accesses = [];
const keep = (value, context) => { accesses.push(context.access); };
const make = () => class { ${member} };
const objects = Array.from({ length: ${count} }, () => new (make())());
const round = Array.from({ length: ${usesPerRound} }, (_, i) => i % objects.length);
export default () => {
  for (let i = 0; i < round.length; i++) {
    const access = accesses[round[i]], o = objects[round[i]];
    ${use}
  }
};
`,
  );
  return (await import(file)).default;
}

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
    const mixin = await load(kind, memberCount, "mixin");
    const construct = await load(kind, memberCount, "new");
    const use = await load(kind, memberCount, "use");
    group(`${kind}, ${memberCount} members`, () => {
      bench(`${evaluationsPerCall} evaluations of the class: ${kind} x ${memberCount}`, define);
      bench(`${evaluationsPerCall} times evaluate, new, read and write: ${kind} x ${memberCount}`, mixin);
      bench(`new: ${kind} x ${memberCount}`, construct);
      bench(`read and write: ${kind} x ${memberCount}`, use);
    });
  }

  for (const what of ["evaluations", "subclasses"]) {
    const rounds = [];
    for (const count of kindsOfObject) {
      rounds.push([count, await load(kind, 1, what, count)]);
    }
    group(`${kind}, ${usesPerRound} reads and writes`, () => {
      for (const [count, round] of rounds) {
        bench(`objects of ${count} ${what} of one class: ${kind}`, round);
      }
    });
  }
}

for (const kind of Object.keys(accessKinds)) {
  const rounds = [];
  for (const count of [1, 9]) {
    rounds.push([count, await loadAccess(kind, count)]);
  }
  group(`context.access of ${kind}, ${usesPerRound} uses`, () => {
    for (const [count, round] of rounds) {
      bench(`context.access, objects of ${count} evaluations of one class: ${kind}`, round);
    }
  });
}

await run();
