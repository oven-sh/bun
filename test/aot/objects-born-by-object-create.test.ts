import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
});

type Row = { rule: string; message: string; line: number; because: { message: string; line: number }[]; cost: Record<string, number> };

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
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--aot-explain=costs-json", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const rows: Row[] = stdout
    .split("\n")
    .filter(line => line.startsWith('{"rank"'))
    .map(line => JSON.parse(line));
  const said = rows.flatMap(row => [row.message, ...row.because.map(step => step.message)]);
  const prefix = "The object is made by Object.create here and has no layout: ";
  return { exitCode, stderr, why: [...new Set(said.filter(message => message.startsWith(prefix)).map(message => message.slice(prefix.length)))] };
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

describe("--aot-explain says why what Object.create makes has no layout", () => {
  const refused: Record<string, [string, string]> = {
    "property descriptors": [
      `export function make(x: number): Point {
  const self = Object.create(Proto, { y: { value: 1, writable: true, enumerable: true, configurable: true } });
  self.x = x;
  return self;
}`,
      "it is given property descriptors.",
    ],
    "no prototype": [
      `export function make(x: number, y: number): Point {
  const self = Object.create(null);
  self.kind = "none";
  self.x = x;
  self.y = y;
  return self;
}`,
      "it is given no prototype.",
    ],
    "a prototype that may be anything": [
      `export function make(prototype: any, x: number, y: number): Point {
  const self = Object.create(prototype);
  self.x = x;
  self.y = y;
  return self;
}`,
      "its prototype is not known to be an object.",
    ],
    "no declared type": [
      `export function make(x: number, y: number) {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
      "no declared type awaits the constant that holds it.",
    ],
    "a name that the type does not declare": [
      `export function make(x: number, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  self.z = 0;
  return self;
}`,
      "its type does not declare every property that is stored to it.",
    ],
    "a value of no known type": [
      `export function make(x: unknown, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
      "a value stored to it is not known to fit the declared type of its property.",
    ],
    "a value of another type": [
      `export function make(x: string, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return self;
}`,
      "a value stored to it is not known to fit the declared type of its property.",
    ],
    "a key that is not known": [
      `export function make(key: string, x: number): Point {
  const self = Object.create(Proto);
  self[key] = x;
  self.y = x;
  return self;
}`,
      "a property of it is changed in another way than by storing a value under a known name.",
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
      "a property of it is deleted.",
    ],
    "the properties of another object": [
      `export function make(from: { x: number; y: number }): Point {
  const self = Object.assign(Object.create(Proto), from);
  self.x++;
  return self;
}`,
      "it is assigned the properties of another object.",
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
    test(title, async () => {
      expect(await explain(body)).toEqual({ exitCode: 0, stderr: expect.any(String), why: why ? [why] : [] });
    });
  }
});
