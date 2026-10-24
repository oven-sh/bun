// The environment of the process: env6 absent. It prints what plain Bun prints.
const p: any = (globalThis as any)[process.argv[3] ?? "process"];
function getterFor(key: string, unread: object): () => unknown {
  let lastRaw: unknown = unread;
  let lastParsed: unknown;
  return () => {
    const raw = p.env[key];
    if (raw !== lastRaw) {
      lastParsed = raw === undefined ? 0 : raw.length;
      lastRaw = raw;
    }
    return lastParsed;
  };
}
const names = ["NOT_THERE_1", "NOT_THERE_2", "NOT_THERE_3", "NOT_THERE_4", "NOT_THERE_5", "NOT_THERE_6", "NOT_THERE_7", "NOT_THERE_8"];
const getters = names.map(name => getterFor(name, names));
const rounds = Number(process.argv[2] ?? 200000);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += getters[i & 7]() as number;
console.log(sum >= 0, rounds);
