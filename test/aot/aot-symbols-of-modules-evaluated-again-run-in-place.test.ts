import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const makesASymbol = `
seen.push(kOwn);
holder[kOwn] = seen.length;
`;
const tells = `
console.log("symbols", seen.length, new Set(seen).size, seen[0] === seen[1], seen[1] === seen[2]);
console.log("keys on an object that outlives the evaluations", Object.getOwnPropertySymbols(holder).length, Object.getOwnPropertySymbols(holder).map(symbol => holder[symbol]).join());
`;
const files = {
  "evicted.mjs": `export const kOwn = Symbol("own");${makesASymbol}export function read(object) { return object[kOwn]; }\n`,
  "evicts.mjs": `
    globalThis.seen = [];
    globalThis.holder = {};
    const path = require.resolve("./evicted.mjs");
    for (const time of [1, 2, 3]) {
      const loaded = await import("./evicted.mjs");
      console.log("got", String(loaded.kOwn), loaded.read(holder), loaded.kOwn === seen[time - 1]);
      delete require.cache[path];
    }
    ${tells}`,
  "throws-twice.cjs": `"use strict";\nconst kOwn = Symbol("own");${makesASymbol}if (seen.length < 3) throw new Error("thrown at load, time " + seen.length);\nmodule.exports = { kOwn, read(object) { return object[kOwn]; } };\n`,
  "retries.cjs": `
    "use strict";
    globalThis.seen = [];
    globalThis.holder = {};
    for (const time of [1, 2, 3]) {
      try {
        const loaded = require("./throws-twice.cjs");
        console.log("got", String(loaded.kOwn), loaded.read(holder), loaded.kOwn === seen[time - 1]);
      } catch (error) {
        console.log("caught", error.message);
      }
    }
    ${tells}`,
};

async function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(["evicts.mjs", "retries.cjs"])(
  "bun run --aot %s: a module whose compiled code runs again makes new symbols each time",
  async entry => {
    using dir = tempDir("aot-symbols-evaluated-again", files);
    const plain = await run(String(dir), ["run", `./${entry}`]);
    const compiled = await run(String(dir), ["run", "--aot", `./${entry}`], { BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    expect(plain.stdout).toContain("symbols 3 3 false false");
  },
  120_000,
);
