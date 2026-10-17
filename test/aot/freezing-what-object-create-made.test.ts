import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: { lib: ["ESNext"], target: "ESNext", module: "Preserve", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true, types: [] },
});

async function rulesOf(body: string) {
  const main = `interface Point {
  readonly kind: string;
  x: number;
  y: number;
}
const Proto = { kind: "point" };
export class Counter {
  count = 0;
  step() {
    this.count = this.count + 1;
    return this.count;
  }
}
${body}
`;
  using dir = tempDir("aot-freezing-what-object-create-made", { "tsconfig.json": tsconfig, "main.ts": main });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--aot-explain=costs-json", "main.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const rows: { rule: string; message: string }[] = stdout
    .split("\n")
    .filter(line => line.startsWith('{"rank"'))
    .map(line => JSON.parse(line));
  return { exitCode, stderr, freezesAnything: rows.some(row => row.message.includes("can freeze any object of the program")) };
}

describe("freezing what Object.create made concerns that object alone", () => {
  const alone: Record<string, string> = {
    "a constant that is born as a record": `export function make(x: number, y: number): Point {
  const self = Object.create(Proto);
  self.x = x;
  self.y = y;
  return Object.freeze(self);
}`,
    "a constant that is not born as a record": `export function make(names: string[]) {
  const self = Object.create(Proto);
  for (const name of names) self[name] = name.length;
  return Object.freeze(self);
}`,
    "Object.assign onto what Object.create made": `export function make(x: number, y: number): Point {
  const self = Object.assign(Object.create(Proto), { x, y });
  return Object.freeze(self);
}`,
    "the creation itself": `export const make = () => Object.seal(Object.create(Proto));`,
  };
  for (const [name, body] of Object.entries(alone)) {
    test(name, async () => {
      expect(await rulesOf(body)).toEqual({ exitCode: 0, stderr: "", freezesAnything: false });
    });
  }

  const anything: Record<string, string> = {
    "a parameter of type any": `export const close = (value: any) => Object.freeze(value);`,
    "a variable that is assigned again": `export function make(other: any) {
  let self = Object.create(Proto);
  self = other;
  return Object.freeze(self);
}`,
  };
  for (const [name, body] of Object.entries(anything)) {
    test(name, async () => {
      expect(await rulesOf(body)).toEqual({ exitCode: 0, stderr: "", freezesAnything: true });
    });
  }
});
