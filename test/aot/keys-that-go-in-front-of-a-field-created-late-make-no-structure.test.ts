import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

// An instance gets keys that its class does not declare, then a field of the class is created behind them, so the order of the keys has a field in the middle. Then keys in front of that field go.
const program = (prepare: string, turn: string) => `
class Record { first = 1; second = "s"; third; fourth; }
const turns = Number(process.env.TURNS), count = Number(process.env.COUNT);
function fill(o, from, to) { for (let i = from; i < to; i++) o["k" + i] = i; }
function ends(keys) { return keys.length + ":" + keys.slice(0, 3).map(String).join() + ".." + keys.slice(-3).map(String).join(); }
function make() { const o = new Record(); delete o.third; delete o.fourth; fill(o, 0, count); ${prepare} return o; }
let o = make();
let seen = 0;
for (let i = 0; i < turns; i++) { ${turn} }
console.log(seen, ends(Reflect.ownKeys(o)), ends(Object.keys(o)), Object.keys({ ...o }).length, JSON.stringify(o).length);
`;
const oneField = `delete o.second; o.second = "again";`;
const twoFields = oneField + ` fill(o, count, count + 100); o.third = 3; fill(o, count + 100, count + 105);`;
const files = {
  "from-the-end.mjs": program(oneField, `delete o["k" + (count - 1 - i)];`),
  "from-the-front.mjs": program(oneField, `delete o["k" + i];`),
  "here-and-there.mjs": program(oneField, `delete o["k" + (i * 7919) % count];`),
  "around-two-fields.mjs": program(twoFields, `delete o["k" + (count - 1 - i)]; delete o["k" + i];`),
  "the-field-goes-and-comes.mjs": program(oneField, `delete o["k" + i]; delete o.second; o.second = i;`),
  "listed-each-time.mjs": program(
    oneField,
    `delete o["k" + i]; if (i % 1000 === 0) seen += Reflect.ownKeys(o).length + Object.keys(o).length;`,
  ),
  "a-symbol-is-the-last-key-in-front.mjs": program(
    `o[Symbol.for("in front")] = 1; ` + oneField,
    `if (i === 5) delete o[Symbol.for("in front")]; delete o["k" + (count - 1 - i)];`,
  ),
  "a-few-keys-of-a-new-object-each-time.mjs": program(
    oneField,
    `o = make(); delete o["k" + (i & 3)]; seen += Object.keys(o).length;`,
  ),
};
const counts: Record<string, number> = { "a-few-keys-of-a-new-object-each-time.mjs": 5 };

test.each(Object.keys(files))(
  "five thousand keys more that go make no Structure more: %s",
  async entry => {
    using dir = tempDir("aot-keys-that-go-in-front-of-a-field", files);
    const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
    expect({
      stderr: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({ stderr: [], exitCode: 0 });
    const structuresMade = async (turns: number) => {
      const path = join(String(dir), `counts-${turns}.txt`);
      const env = { ...bunEnv, TURNS: String(turns), COUNT: String(counts[entry] ?? 24000) };
      const ran = await run([executable], String(dir), { ...env, [runtimeEnvironment.countsPath]: path });
      const plain = await run([bunExe(), entry], String(dir), env);
      expect(ran).toEqual(plain);
      expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const made = /^(\d+)\tcounter:CompiledStructuresMade$/m.exec(readFileSync(path, "utf8"));
      return Number(made![1]);
    };
    expect((await structuresMade(10000)) - (await structuresMade(5000))).toBe(0);
  },
  240_000,
);
