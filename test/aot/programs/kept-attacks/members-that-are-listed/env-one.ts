// Members that are listed: env one. It prints what plain Bun prints.
import path from "node:path";
const unknownProcess: any = (globalThis as any)[process.argv[9] ?? "process"];
function provenGetter(key: string, unread: object): () => unknown {
  let lastRaw: unknown = unread;
  let lastParsed: unknown;
  return () => {
    const raw = process.env[key];
    if (raw !== lastRaw) {
      lastParsed = raw === undefined ? 0 : raw.length;
      lastRaw = raw;
    }
    return lastParsed;
  };
}
function unknownGetter(key: string, unread: object): () => unknown {
  let lastRaw: unknown = unread;
  let lastParsed: unknown;
  return () => {
    const raw = unknownProcess.env[key];
    if (raw !== lastRaw) {
      lastParsed = raw === undefined ? 0 : raw.length;
      lastRaw = raw;
    }
    return lastParsed;
  };
}
const names = ["HOME", "NOT_THERE_1", "PATH", "NOT_THERE_2", "USER", "NOT_THERE_3", "TERM", "NOT_THERE_4"];
const word = process.argv[2];
const rounds = Number(process.argv[3] ?? 200000);
const getters = names.map(name => (word === "proven" ? provenGetter : unknownGetter)(name, names));
let sum = 0;
for (let i = 0; i < rounds; i++) {
  if (path.isAbsolute("/a")) sum += getters[i & 7]() as number;
}
console.log(sum > 0, rounds);
