import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { mutatedTypesFlags } from "./open-types";
import { test } from "./supported";

// `aot: mutation: field-deleted at main.ts:10:25, 6 accesses, types 'Counter', why object-changed`
const mutationLine =
  /^aot: mutation: ([a-z-]+) at .+?:\d+:\d+, [\d,]+ access(?:es)?, types ('.+?'(?:, '.+?')*)(?:, why [a-z-]+)?$/;

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
});

async function check(body: string) {
  // Every export of an entry point reaches unknown code, so the program exports only numbers.
  const main = `interface Point {
  readonly kind: string;
  x: number;
  y: number;
}
const Proto = { kind: "point" };
const origin: Point = { kind: "point", x: 0, y: 0 };
export const distance = origin.x + origin.y;
class Counter {
  count = 0;
  step() {
    this.count = this.count + 1;
    return this.count;
  }
}
export const stepped = new Counter().step();
${body}
`;
  using dir = tempDir("aot-freeze-object-create-result", { "tsconfig.json": tsconfig, "main.ts": main });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", ...mutatedTypesFlags, "main.ts"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const output = stdout + stderr;
  // step() stores to count in every program.
  const mutations = output
    .split("\n")
    .flatMap(line => {
      const [, reason, names] = mutationLine.exec(line) ?? [];
      return names === undefined ? [] : names.split(", ").map(name => ({ name: name.slice(1, -1), reason }));
    })
    .filter(type => (type.name === "Point" || type.name === "Counter") && type.reason !== "store-after-creation")
    .map(type => `${type.name}: ${type.reason}`);
  return {
    exitCode,
    errors: output.split("\n").filter(line => /error TS|panic/.test(line)),
    mutations: [...new Set(mutations)],
  };
}

function expectNoMutation(bodies: Record<string, string>) {
  for (const [name, body] of Object.entries(bodies)) {
    test(name, async () => {
      expect(await check(body)).toEqual({ exitCode: 0, errors: [], mutations: [] });
    });
  }
}

describe("Object.create, Object.assign and Object.freeze on an ordinary object mutate no layout", () => {
  expectNoMutation({
    "stores that match a record type": `function make(x: number, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return Object.freeze(self);
}
make(1, 2);`,
    "stores by computed key": `function make(names: string[]) {
  const self = Object.create(Proto);
  for (const name of names) self[name] = name.length;
  return Object.freeze(self);
}
make(["a", "b"]);`,
    "Object.assign onto the result of Object.create": `function make(x: number, y: number): Point {
  const self = Object.assign(Object.create(Proto), { x, y });
  return Object.freeze(self);
}
make(1, 2);`,
    "Object.seal of the result of Object.create": `const make = () => Object.seal(Object.create(Proto));
make();`,
  });
});

describe("Object.freeze of a parsed value mutates no layout", () => {
  expectNoMutation({
    "a parameter of type any": `function close(value: any) {
  return Object.freeze(value);
}
close(JSON.parse("{}"));`,
    "a parameter of type any returned as a record type": `function make(value: any): Point {
  return Object.freeze(value);
}
make(JSON.parse("{}"));`,
  });
});

describe("control", () => {
  test("a deleted field lists its class", async () => {
    expect(
      await check(
        `const counter = new Counter();\ndelete (counter as any).count;\nexport const reached = counter.step();`,
      ),
    ).toEqual({
      exitCode: 0,
      errors: [],
      mutations: ["Counter: field-deleted"],
    });
  });

  // A frozen object keeps its layout, and no report names the place that freezes it.
  test.todo("a frozen instance lists its class");
  test.todo("a frozen record lists its type");
});
