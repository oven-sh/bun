import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

type Place = { file: string; line: number; column: number };
type Row = Place & {
  rank: number;
  rule: string;
  inDependency: boolean;
  source: string;
  message: string;
  because: (Place & { message: string })[];
  types: string[];
  examples: Place[];
  otherCauses: Place[];
  cost: Record<string, number>;
  fix: string;
};

const at = (place: Place) => `${place.file}:${place.line}:${place.column}`;
async function check(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-explain-costs", { "tsconfig.json": tsconfig, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", ...flags, "main.ts"],
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
  return { rows, stdout, stderr, exitCode };
}

const door = {
  "main.ts": `interface Server {
  port: number;
  host: string;
}
interface Config {
  server: Server;
  names: string[];
}
export const config = JSON.parse(text) as Config;
export function address(config: Config): string {
  return config.server.host + ":" + config.server.port;
}
export function longest(config: Config): number {
  let most = 0;
  for (const name of config.names) most = Math.max(most, name.length + config.server.port);
  return most;
}
export function port(server: Server): number {
  return server.port;
}
export const shown = address(config) + longest(config) + port(config.server);
declare const text: string;
`,
};

const marks = {
  "main.ts": `interface Row {
  id: number;
  name: string;
}
const none = Object.freeze(Object.create(null));
function seal(value: any): void {
  Object.seal(value);
}
function adopt(value: any, base: object): void {
  Object.setPrototypeOf(value, base);
}
const kept = Object.freeze({ id: 0, name: "kept" });
export function rename(row: Row, name: string): void {
  row.name = name;
  row.id += 1;
}
const row: Row = { id: 1, name: "a" };
rename(row, "b");
seal({});
adopt({}, {});
export const shown = [row.name, kept.name, none];
interface Tagged {
  id: number;
  tag?: string;
}
export function tagOf(value: Tagged): string | undefined {
  return value.tag;
}
export const tag = tagOf({ id: 1 });
`,
};

const several = {
  "main.ts": `interface Point {
  x: number;
  y: number;
}
function fromAnywhere(value: any): Point {
  return value;
}
export function norm(point: Point): number {
  return point.x * point.x + point.y * point.y;
}
export function total(list: any): number {
  let sum = 0;
  for (let i = 0; i < list.items.length; i++) sum += list.items[i].price;
  return sum;
}
class Fiber {
  declare id: number;
  [String(Math.random())]() {}
}
export const fiber = new Fiber();
export const shown = norm(fromAnywhere({ x: 3, y: 4 })) + norm({ x: 1, y: 2 }) + total({ items: [{ price: 1 }] });
`,
};

const helper = {
  "main.ts": `interface Box {
  value: number;
  label: string;
}
function dual<F extends (...args: Array<any>) => any>(arity: number, body: F): F {
  return function (this: unknown) {
    if (arguments.length >= arity) return body.apply(this, arguments as any);
    const rest = arguments;
    return (self: any) => body(self, ...(rest as any));
  } as any;
}
export const add = dual(2, (self: Box, by: number): Box => ({ value: self.value + by, label: self.label }));
export const rename = dual(2, (self: Box, label: string): Box => ({ value: self.value, label }));
export const shown = rename(add({ value: 1, label: "a" }, 2), "b").label;
`,
};

const serialized = {
  "main.ts": `interface Receipt {
  id: number;
  total: number;
}
function send<T>(value: T): string {
  return JSON.stringify(value);
}
function sendReceipt(value: Receipt): string {
  return JSON.stringify(value);
}
export const shown = send({ id: 1, total: 2 }) + sendReceipt({ id: 2, total: 3 });
`,
};

describe.concurrent("--aot-explain=costs-json", () => {
  test("everything that one JSON.parse costs is one row, at the JSON.parse", async () => {
    const { rows, exitCode } = await check(door, "--aot-explain=costs-json");
    expect(exitCode).toBe(0);
    expect(rows[0]).toMatchObject({
      rank: 1,
      rule: "external-type",
      file: "main.ts",
      line: 9,
      column: 23,
      inDependency: false,
      source: "export const config = JSON.parse(text) as Config;",
      message: "A value from outside the type system is used as 'Config' here.",
      types: ["Server", "Config"],
      otherCauses: [],
      fix: "check the value where it enters the program and build a new object from it in typed code, instead of asserting its type",
    });
    expect(rows.filter(row => row.rule === "external-type").length).toBe(1);
    expect(rows[0].cost.readsByName).toBeGreaterThanOrEqual(8);
    expect(rows[0].cost.functions).toBe(4);
    expect(rows[0].examples.map(at)).toContain("main.ts:11:17");
    expect(rows.map(row => row.message)).toContain(
      "The compiler cannot prove that what 'name' holds is of its type 'string', so its properties are looked up by name.",
    );
  }, 60_000);

  test("every place that can freeze or re-parent any object is named", async () => {
    const { rows } = await check(marks, "--aot-explain=costs-json");
    const found = rows.filter(row => row.rule === "reshaped-layout");
    expect(found.map(row => [at(row), ...row.otherCauses.map(at)].join(" ")).sort()).toEqual([
      "main.ts:10:25",
      "main.ts:5:28 main.ts:7:15",
    ]);
    expect(found.map(row => row.cost.guardedAccesses > 0)).toEqual([true, true]);
  }, 60_000);

  test("a helper that calls what it is given without knowing its parameters is one row", async () => {
    const { rows } = await check(helper, "--aot-explain=costs-json");
    const row = rows.find(row => row.cost.checksOfParameters > 0 && at(row) === "main.ts:5:1");
    expect(row).toMatchObject({
      rule: "can-throw",
      message:
        "'dual' calls the functions it is given without knowing their parameter types, so each of them checks its arguments when it is entered.",
      cost: { checksOfParameters: 2 },
    });
  }, 60_000);

  test("JSON.stringify of a value of unknown type is a row, of a declared type it is none", async () => {
    const { rows } = await check(serialized, "--aot-explain=costs-json");
    expect(
      rows.filter(row => row.cost.unspecializedCalls > 0).map(row => `${at(row)} ${row.cost.unspecializedCalls}`),
    ).toEqual(["main.ts:6:25 1"]);
    expect(rows[0]).toMatchObject({
      message: "The type of this object is the type parameter 'T'.",
      fix: "make the call where the type of the value is known, or give the value a declared type",
    });
  }, 60_000);

  test("the most expensive cause comes first", async () => {
    const { rows } = await check(several, "--aot-explain=costs-json");
    expect(rows.slice(0, 2).map(row => `${row.rank} ${row.rule} ${at(row)}`)).toEqual([
      "1 by-name main.ts:11:23",
      "2 open-layout main.ts:6:10",
    ]);
    expect(rows.map(row => `${row.rule} ${at(row)}`)).toContain("lost-layout main.ts:16:7");
    expect(rows.map(row => row.cost.score)).toEqual(rows.map(row => row.cost.score).toSorted((a, b) => b - a));
    expect(rows[1]).toMatchObject({
      types: ["Point"],
      message: "A value of type 'any' or 'unknown' is assigned to it here.",
    });
    expect(rows[1].cost.checks + rows[1].cost.guardedAccesses).toBeGreaterThan(0);
  }, 60_000);
});

describe.concurrent("--aot-explain", () => {
  test.each(["--aot-explain", "--aot-explain=costs"])(
    "%s prints the rows for a person",
    async flag => {
      const { stderr, stdout, exitCode } = await check(door, flag);
      expect(exitCode).toBe(0);
      expect(stdout).not.toContain('{"rank"');
      expect(stderr).toMatch(
        /^aot: \d+ places? where the compiler gives something up, \d+ with a cost that can be counted\. The most expensive first:$/m,
      );
      const first = stderr.slice(stderr.indexOf("  1. "), stderr.indexOf("\n\n", stderr.indexOf("  1. "))).split("\n");
      expect(first.slice(0, 3)).toEqual([
        "  1. main.ts:9:23 [external-type]",
        "     | export const config = JSON.parse(text) as Config;",
        "     A value from outside the type system is used as 'Config' here.",
      ]);
      expect(first[3]).toMatch(
        /^     cost: \d+ reads by name, .* in 4 functions \(1 runs only while the program starts\)$/,
      );
      expect(first[4]).toBe("     types: 'Server', 'Config'");
      expect(first.at(-1)).toBe(
        "     fix: check the value where it enters the program and build a new object from it in typed code, instead of asserting its type",
      );
      expect(stderr).toMatch(/^ In all, by rule:\n     external-type: 1 place: \d+ reads by name/m);
    },
    60_000,
  );

  test("reports no finding as a warning or an error", async () => {
    const { stderr, stdout, exitCode } = await check(marks, "--aot-explain");
    expect(exitCode).toBe(0);
    expect(stdout + stderr).not.toMatch(/(warning|error) TS1000/);
  }, 60_000);

  test("leaves the rules that are asked for as they are", async () => {
    const { stdout, stderr, exitCode } = await check(marks, "--aot-explain", "--aot-deny=reshaped-layout");
    expect(exitCode).toBe(1);
    expect(
      (stdout + stderr)
        .split("\n")
        .filter(line => /error TS1000/.test(line))
        .map(line => line.slice(0, line.indexOf(": ", line.indexOf("TS")))),
    ).toEqual(["main.ts(5,28): error TS100080", "main.ts(10,25): error TS100081"]);
  }, 60_000);
});
