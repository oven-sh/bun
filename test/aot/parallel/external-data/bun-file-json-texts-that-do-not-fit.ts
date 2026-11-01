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
  untyped: path => Bun.file(path).json(),
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
  '{"port":"5","host":6}',
  '{"port":7}',
  '{"port":8,"host":"f","port":9}',
  '{"port":10,"host":"g","__proto__":{"x":1}}',
  '{"port":11,"host":"h","tags":"none","limits":7}',
  '{"port":12,"host":"\\u00e9\\ud83d\\ude00 \\n"}',
  '{"port":13,"host":"é😀"}',
  "[]",
  '[{"port":14,"host":"i"}]',
  "null",
  "17",
  '"text"',
  "",
  " ",
  "{",
  '{"port":15,"host":"j"',
  '{"port":16,"host":"k"} x',
  '{"port":17,"host":"l",}',
  '{"port":01,"host":"m"}',
  "﻿" + '{"port":18,"host":"n"}',
  new Uint8Array([0x7b, 0x22, 0x70, 0x6f, 0x72, 0x74, 0x22, 0x3a, 0x31, 0x2c, 0x22, 0x68, 0x6f, 0x73, 0x74, 0x22, 0x3a, 0x22, 0xff, 0xc3, 0x22, 0x7d]),
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

for (const [name, read] of Object.entries(readers)) {
  try {
    console.log(name, await read(join(folder, "missing.json")));
  } catch (error) {
    console.log(name, (error as NodeJS.ErrnoException).code);
  }
}

const own = Bun.file(await write('{"port":20,"host":"o"}'));
(own as any).json = async () => ({ port: -1, host: "own" });
console.log(describe(await parameter(own)));
console.log(describe(await parameter({ json: async () => ({ port: -2, host: "not a file" }) } as unknown as BunFile)));

rmSync(folder, { recursive: true, force: true });
