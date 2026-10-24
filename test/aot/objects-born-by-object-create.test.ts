import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

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

type Row = {
  rule: string;
  message: string;
  line: number;
  because: { message: string; line: number }[];
  cost: Record<string, number>;
};

async function explain(body: string) {
  const main = `interface Point {
  readonly kind: string;
  x: number;
  y: number;
}
const Proto = { kind: "point" };
${body}
export const sum = (point: Point) => point.x + point.y + point.kind.length;
`;
  using dir = tempDir("aot-objects-born-by-object-create", { "tsconfig.json": tsconfig, "main.ts": main });
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "check", "--aot", "--no-pretty", "--explain=json", "main.ts"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  const rows: Row[] = stdout
    .split("\n")
    .filter(line => line.startsWith('{"rank"'))
    .map(line => JSON.parse(line));
  const said = rows.flatMap(row => [row.message, ...row.because.map(step => step.message)]);
  const prefix = "The object is created by Object.create() here, so it is untyped: ";
  return {
    exitCode,
    stderr,
    why: [...new Set(said.filter(message => message.startsWith(prefix)).map(message => message.slice(prefix.length)))],
  };
}

describe("what Object.create makes is born as the record that its declared type names", () => {
  const born: Record<string, string> = {
    "stores behind the declaration, returned": `export function make(x: number, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
    "an annotated constant": `export function make(x: number, y: number) {
  const self: Point = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
    "an assertion": `export function make(x: number, y: number) {
  const self = Object.create(Proto) as Point;
  self.x = x;
  self.y = y;
  return self;
}`,
    "Object.assign of a literal": `export const make = (x: number, y: number): Point => Object.assign(Object.create(Proto), { x, y });`,
    "frozen on its way out": `export function make(x: number, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return Object.freeze(self);
}`,
  };
  for (const [title, body] of Object.entries(born)) {
    test(title, async () => {
      expect(await explain(body)).toEqual({ exitCode: 0, stderr: expect.any(String), why: [] });
    });
  }
});

describe("--explain says why what Object.create makes has no layout", () => {
  const refused: Record<string, [string, string]> = {
    "property descriptors": [
      `export function make(x: number): Point {
  const self = Object.create(Proto, { y: { value: 1, writable: true, enumerable: true, configurable: true } });
  self.x = x;
  return self;
}`,
      "the call passes property descriptors.",
    ],
    "no prototype": [
      `export function make(x: number, y: number): Point {
  const self = Object.create(null);
  self.kind = "none";
  self.x = x;
  self.y = y;
  return self;
}`,
      "the call does not pass a prototype object.",
    ],
    "a prototype that may be anything": [
      `export function make(prototype: any, x: number, y: number): Point {
  const self = Object.create(prototype);
  self.x = x;
  self.y = y;
  return self;
}`,
      "its prototype might not be an object.",
    ],
    "no declared type": [
      `export function make(x: number, y: number) {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
      "the 'const' it is assigned to is never used as a declared object type.",
    ],
    "a name that the type does not declare": [
      `export function make(x: number, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  self.z = 0;
  return self;
}`,
      "its type does not declare every property that is assigned to it.",
    ],
    "a value of no known type": [
      `export function make(x: unknown, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
      "a value assigned to one of its properties might not match the declared type.",
    ],
    "a value of another type": [
      `export function make(x: string, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
      "a value assigned to one of its properties might not match the declared type.",
    ],
    "a key that is not known": [
      `export function make(key: string, x: number): Point {
  const self = Object.create(Proto);
  self[key] = x;
  self.y = x;
  return self;
}`,
      "one of its properties is assigned with a computed name, or with anything other than '='.",
    ],
    "a property that is deleted": [
      `export function make(x: number, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  delete self.x;
  self.x = y;
  return self;
}`,
      "one of its properties is deleted.",
    ],
    "the properties of another object": [
      `export function make(from: { x: number; y: number }): Point {
  const self = Object.assign(Object.create(Proto), from);
  self.x++;
  return self;
}`,
      "the properties that Object.assign() adds to it are not known.",
    ],
    "another Object": [
      `export function make(Object: { create(prototype: object): any }, x: number, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
      "",
    ],
  };
  for (const [title, [body, why]] of Object.entries(refused)) {
    // TODO: --explain prints none of these reasons.
    (why ? test.todo : test)(title, async () => {
      expect(await explain(body)).toEqual({ exitCode: 0, stderr: expect.any(String), why: why ? [why] : [] });
    });
  }
});
