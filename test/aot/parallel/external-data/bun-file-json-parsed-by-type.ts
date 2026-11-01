// Flags: --aot-log-type-mismatches
// Prints what the compiler saves: casts that find an untyped object
// STATISTIC: TypedResultsSelected >= 6
import type { BunFile } from "bun";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Settings {
  port: number;
  host: string;
  tags?: string[];
  limits?: { depth: number | null };
}

const folder = join(tmpdir(), `bun-file-json-${process.pid}`);
let written = 0;
async function write(text: string | Uint8Array): Promise<string> {
  const path = join(folder, `${written++}.json`);
  await Bun.write(path, text);
  return path;
}

async function cast(path: string): Promise<unknown> {
  return (await Bun.file(path).json()) as Settings;
}
async function annotated(path: string): Promise<unknown> {
  const settings: Settings = await Bun.file(path).json();
  return settings;
}
async function returned(path: string): Promise<Settings> {
  return await Bun.file(path).json();
}
async function keptAcrossAwait(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) return "missing";
  return (await file.json()) as Settings;
}
async function parameter(file: BunFile): Promise<unknown> {
  return (await file.json()) as Settings;
}
async function slice(path: string): Promise<unknown> {
  const file = Bun.file(path);
  return (await file.slice(0, file.size).json()) as Settings;
}
const readers: Record<string, (path: string) => Promise<unknown>> = {
  cast,
  annotated,
  returned,
  keptAcrossAwait,
  parameter: path => parameter(Bun.file(path)),
  slice,
};

function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value + " " + String(value);
  const settings = value as Settings;
  return [
    JSON.stringify(value),
    Object.keys(value).join(),
    typeof settings.port,
    typeof settings.host,
    Array.isArray(settings.tags) ? settings.tags.length : settings.tags,
    settings.limits?.depth,
    Object.getPrototypeOf(value) === Object.prototype || Array.isArray(value),
  ].join(" | ");
}

const texts: (string | Uint8Array)[] = [
  '{"port":8080,"host":"localhost"}',
  '{"host":"a","port":1.5}',
  ' \n{"port":1,"host":"b","tags":["x","y"],"limits":{"depth":3}}\t',
  '{"port":2,"host":"c","tags":[],"limits":{"depth":null}}',
  '{"port":3,"host":"d","extra":true,"more":{"deep":[1,2,{"k":null}]}}',
  '{"extra":1,"port":4,"host":"e"}',
  '{"port":12,"host":"\\u00e9\\ud83d\\ude00 \\n"}',
  '{"port":13,"host":"é😀"}',
  '{"port":19,"host":"' + "z".repeat(5000) + '"}',
];

for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    const path = await write(text);
    const answers: string[] = [];
    for (const [name, read] of Object.entries(readers)) {
      let answer: string;
      try {
        answer = describe(await read(path));
      } catch (error) {
        answer = (error as Error).name + ": " + (error as Error).message;
      }
      if (answer.length > 200) answer = answer.length + " " + answer.slice(0, 60);
      if (!answers.includes(answer)) answers.push(answer);
      if (answers.length > 1) console.log("differs", name);
    }
    if (!round) console.log(answers[0]);
  }
}

rmSync(folder, { recursive: true, force: true });
