import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { built, spawned } from "./run-programs";
import { test } from "./supported-with-counted-calls";

const files = {
  "main.ts": `
    declare const process: { argv: string[] };
    declare const console: { log(...values: unknown[]): void };
    function versionOf(versions: Map<string, number>, scope: string, name: string): number | undefined { return versions.get(scope + "/" + name); }
    function isKnown(versions: Map<string, number>, scope: string, name: string, major: number): boolean { return versions.has(scope + "/" + name + "@" + (major | 0)); }
    function isListed(listed: Set<string>, scope: string, name: string): boolean { return listed.has(scope + name); }
    function versionOfKeptKey(versions: Map<string, number>, scope: string, name: string): number | undefined {
      const key = scope + "/" + name;
      return versions.has(key) ? versions.get(key) : undefined;
    }
    const scopes = ["@types", "@babel", "", "lodash", "caf\\u00e9"], names = ["node", "core", "x".repeat(30), "", "fp", "-1", "12"];
    const versions = new Map<string, number>(), listed = new Set<string>();
    for (let s = 0; s < scopes.length; s++) for (let n = 0; n < names.length; n++) {
      if ((s + n) % 2) continue;
      versions.set([scopes[s], names[n]].join("/"), s * 10 + n);
      versions.set([scopes[s], "/", names[n], "@", String(n % 5)].join(""), n);
      listed.add([scopes[s], names[n]].join(""));
    }
    const way = process.argv[2], rounds = Number(process.argv[3]);
    let sum = 0;
    for (let round = 0; round < rounds; round++) {
      const scope = scopes[round % scopes.length], name = names[(round >> 2) % names.length];
      if (way === "kept") {
        sum += versionOfKeptKey(versions, scope, name) ?? -1;
        continue;
      }
      sum += versionOf(versions, scope, name) ?? -1;
      if (isKnown(versions, scope, name, round % 5)) sum += 100;
      if (isListed(listed, scope, name)) sum += 1000;
    }
    console.log(sum);
  `,
};

const lookupsByParts = ["operationAOTMapGetByKeyParts", "operationAOTHasByKeyParts"];
const makersOfStrings = [
  "operationAOTConcatenate",
  "operationAOTConcat",
  "operationAOTConcatThree",
  "operationAOTIntToString",
  "operationAOTStringBuilderFinish",
  "operationAOTStringBuilderToString",
];
const lookupsOfStrings = ["operationAOTMapGet", "operationAOTMapHas", "operationAOTSetHas"];
const operations = [...lookupsByParts, ...makersOfStrings, ...lookupsOfStrings];
const lookups = 10_000;

// TODO: the key is put together by a call and looked up as a string.
test.todo(
  "a key that is put together for one lookup in a Map or a Set is not made",
  async () => {
    using dir = tempDir("aot-lookups-by-key-parts", files);
    const cwd = String(dir);
    const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
    built(await spawned([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable], cwd, bunEnv));

    const counted = async (way: string, rounds: number) => {
      const path = join(cwd, `counts-${way}-${rounds}`);
      const plain = await spawned([bunExe(), "main.ts", way, String(rounds)], cwd, bunEnv);
      const compiled = await spawned([executable, way, String(rounds)], cwd, {
        ...bunEnv,
        [runtimeEnvironment.countsPath]: path,
      });
      expect(compiled).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0, signal: null });
      const counts: Record<string, number> = Object.fromEntries(operations.map(name => [name, 0]));
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const [count, name] = line.split("\toperation:");
        // Every VM of the process writes its own lines.
        if (name !== undefined && name in counts) counts[name] = counts[name]! + Number(count);
      }
      return counts;
    };
    // What the program does before its loop is the same in both runs.
    const callsOfMoreRounds = async (way: string) => {
      const few = await counted(way, 100);
      const many = await counted(way, 100 + lookups);
      return Object.fromEntries(operations.map(name => [name, many[name]! - few[name]!]));
    };

    expect(await callsOfMoreRounds("parts")).toEqual({
      ...Object.fromEntries(operations.map(name => [name, 0])),
      operationAOTMapGetByKeyParts: lookups,
      operationAOTHasByKeyParts: 2 * lookups,
    });

    // A key that is kept for a second lookup is made. A renamed operation would count none here.
    const kept = await callsOfMoreRounds("kept");
    expect({ made: kept.operationAOTConcatenate, byParts: lookupsByParts.map(name => kept[name]) }).toEqual({
      made: lookups,
      byParts: [0, 0],
    });
  },
  240_000,
);
