// Writes the pins of a platform that has none from the logs of a run there: ./idioms.test.ts prints a line `IDIOM <name> <typed> <untyped>` for each idiom that it measures, and
// ./pinned-everyday-idioms.ts a line `EVERYDAY <name> <typed> <untyped>`, ./pinned-applications.ts a line `APPLICATION <name> <instructions>`.
//
//   bun test/aot/perf/pins-from-a-log.ts linux-arm64 <log> ..     writes ./pins.linux-arm64.json, ./everyday-pins.linux-arm64.json and ./application-pins.linux-arm64.json,
//                                                                 each if the logs have lines for it
//
// Where an idiom was measured more than once the larger number is pinned: AOT_PERF=lower brings a pin down, and nothing brings one up.
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const [platform, ...logs] = process.argv.slice(2);
if (!/^[a-z0-9]+-[a-z0-9]+$/.test(platform ?? "") || logs.length === 0) {
  console.error("usage: bun test/aot/perf/pins-from-a-log.ts <os>-<arch> <log> ..");
  process.exit(2);
}

const text = logs.map(log => readFileSync(log, "utf8")).join("\n");
for (const [word, file] of [
  ["IDIOM", `pins.${platform}.json`],
  ["EVERYDAY", `everyday-pins.${platform}.json`],
]) {
  const pins = new Map<string, { typed: number; untyped: number }>();
  for (const [, name, typed, untyped] of text.matchAll(
    new RegExp(`\\b${word} (\\S+)\\s+([0-9.]+)\\s+([0-9.]+)`, "g"),
  )) {
    const before = pins.get(name);
    pins.set(name, {
      typed: Math.max(Number(typed), before?.typed ?? 0),
      untyped: Math.max(Number(untyped), before?.untyped ?? 0),
    });
  }
  if (pins.size === 0) continue;
  const sorted = Object.fromEntries([...pins].sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(join(import.meta.dir, file), JSON.stringify(sorted, null, 2) + "\n");
  console.log(`${file}: ${pins.size} idioms`);
}

const applications = new Map<string, number>();
for (const [, name, instructions] of text.matchAll(/\bAPPLICATION (\S+)\s+([0-9]+)/g))
  applications.set(name, Math.max(Number(instructions), applications.get(name) ?? 0));
if (applications.size) {
  writeFileSync(
    join(import.meta.dir, `application-pins.${platform}.json`),
    JSON.stringify(Object.fromEntries([...applications].sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) + "\n",
  );
  console.log(`application-pins.${platform}.json: ${applications.size} rows`);
}
