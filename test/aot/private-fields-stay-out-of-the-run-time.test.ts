// A private field of a compiled class lies in a slot of the object. Defining, reading, storing and testing it is a few instructions of
// compiled code, not a call of the run time's C++, also where the compiler knows little about the objects.
//
// Each program runs a few and many rounds. An operation on private names whose calls grow with the rounds fails the program.
//
//   AOT_PRIVATE=<text>    only the programs whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported-with-counted-calls";

// `round(i)` answers a number. What stands in front of it runs once.
const programs: Record<string, string> = {
  "fields declared without a value and stored by the constructor": `
    class Three { #a: number; #b = 2; #c: string; constructor(a: number, c: string) { this.#a = a; this.#c = c; } sum(): number { return this.#a + this.#b + this.#c.length; } }
    const round = (i: number) => new Three(i, "ab").sum();`,
  "a boolean and a fraction declared without a value": `
    class Two { #on: boolean; #ratio: number; constructor(i: number) { this.#on = i > 1; this.#ratio = i + 0.5; } sum(): number { return this.#on ? this.#ratio : 1; } }
    const round = (i: number) => new Two(i).sum();`,
  "a private method": `
    class WithMethod { #a: number; constructor(a: number) { this.#a = a; } #twice(): number { return this.#a * 2; } run(): number { return this.#twice(); } }
    const round = (i: number) => new WithMethod(i).run();`,
  "public and private fields declared side by side": `
    class Mixed { count: number; #count: number; constructor(n: number) { this.#count = n; this.count = n + 1; } sum(): number { return this.count + this.#count; } }
    const round = (i: number) => new Mixed(i).sum();`,
  "a class whose objects reach run-time text": `
    class Slot { #made = 0; readonly #states = new WeakMap<object, number>(); #name: string; constructor(name: string) { this.#name = name; }
      of(key: object): number { let state = this.#states.get(key); if (state === undefined) this.#states.set(key, state = ++this.#made); return state + this.#name.length; }
      static has(value: object): boolean { return #states in value; } }
    const unknownCode = new Function("value", process.argv[3] ?? "return value") as <V>(value: V) => V;
    const key = {};
    const kept = unknownCode(new Slot("kept"));
    const round = (i: number) => unknownCode(new Slot("n")).of(key) + kept.of(key) + (Slot.has(kept) ? 1 : 0);`,
  "a class below a class whose objects reach run-time text": `
    class Base { #a = 1; #b: number; constructor(b: number) { this.#b = b; } sum(): number { return this.#a + this.#b; } }
    class Below extends Base { extra = 1; }
    const unknownCode = new Function("value", process.argv[3] ?? "return value") as <V>(value: V) => V;
    const round = (i: number) => unknownCode(new Below(i)).sum() + unknownCode(new Base(i)).sum();`,
};

// TODO: who still asks the run time, and for what.
const asksToday: Record<string, string[]> = {
  "names of a class below a parent, on objects that reach run-time text": ["operationAOTPrivateDefine"],
};
Object.assign(programs, {
  "a method whose generic version reads the field": `
    class Host { name = "host"; }
    class Slot { readonly #states = new WeakMap<Host, number>(); of(host: Host): number { let state = this.#states.get(host); if (state === undefined) this.#states.set(host, state = 1); return state; } }
    const unknownCode = new Function("value", process.argv[3] ?? "return value") as <V>(value: V) => V;
    const slot = unknownCode(new Slot());
    const other = JSON.parse('{"name":"other","more":1}') as Host;
    const round = (i: number) => slot.of(other);`,
  "names of a class below a parent, on objects that reach run-time text": `
    class Base { a = 1; }
    class Below extends Base { #b = 2; sum(): number { return this.a + this.#b; } }
    const unknownCode = new Function("value", process.argv[3] ?? "return value") as <V>(value: V) => V;
    const round = (i: number) => unknownCode(new Below()).sum();`,
});

function program(text: string) {
  return `declare const process: { argv: string[] };
    declare const console: { log(value: unknown): void };
    ${text}
    const rounds = Number(process.argv[2]);
    let sum = 0;
    for (let i = 0; i < rounds; i++) sum += round(i);
    console.log(sum >= 0);
  `;
}

async function growingPrivateOperations(folder: string) {
  const executable = join(folder, isWindows ? "main.exe" : "main");
  built(await spawned([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", executable], folder, bunEnv));
  const counted = async (rounds: number) => {
    const path = join(folder, `counts-${rounds}`);
    const ran = await spawned([executable, String(rounds)], folder, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: path,
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    const counts = new Map<string, number>();
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, operation] = line.split("\toperation:");
      if (operation?.startsWith("operationAOTPrivate")) counts.set(operation, Number(count));
    }
    return counts;
  };
  const [few, many] = [await counted(500), await counted(4500)];
  return [...many]
    .filter(([operation, count]) => count - (few.get(operation) ?? 0) > 400)
    .map(([operation]) => operation);
}

const only = process.env.AOT_PRIVATE;

describe.concurrent("private fields stay out of the run time", () => {
  for (const [name, text] of Object.entries(programs)) {
    if (only && !name.includes(only)) continue;
    const known = asksToday[name];
    (known ? test.todo : test)(
      known ? `${name} (${known.join(", ")})` : name,
      async () => {
        using dir = tempDir("aot-private-fields", { "main.ts": program(text) });
        expect((await growingPrivateOperations(String(dir))).sort()).toEqual([]);
      },
      240_000,
    );
  }
});
