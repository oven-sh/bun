// Members that are listed: env two. It prints what plain Bun prints.
import path from "node:path";
type Field = { parse(raw: string | undefined): unknown };
function getterFor(key: string, field: Field, unread: object): () => unknown {
  let lastRaw: unknown = unread;
  let lastParsed: unknown;
  return () => {
    const raw = process.env[key];
    if (raw !== lastRaw) {
      lastParsed = field.parse(raw);
      lastRaw = raw;
    }
    return lastParsed;
  };
}
function build(shape: Record<string, Field>): Record<string, unknown> {
  const accessor: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) Object.defineProperty(accessor, key, { get: getterFor(key, shape[key], accessor), configurable: true });
  return accessor;
}
const flag: Field = { parse: raw => raw === "1" || raw === "true" };
const text: Field = { parse: raw => raw };
const settings = build({ HOME: text, NOT_THERE_1: flag, PATH: text, NOT_THERE_2: flag, USER: text, NOT_THERE_3: flag }) as {
  HOME: string; NOT_THERE_1: boolean; PATH: string; NOT_THERE_2: boolean; USER: string; NOT_THERE_3: boolean;
};
const rounds = Number(process.argv[3] ?? 200000);
let sum = 0;
for (let i = 0; i < rounds; i++) {
  if (!path.isAbsolute("/a")) continue;
  if (settings.NOT_THERE_1) sum++;
}
console.log(sum >= 0, rounds);
