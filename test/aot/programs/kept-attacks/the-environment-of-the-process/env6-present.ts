// The environment of the process: env6 present. It prints what plain Bun prints.
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
const names = ["HOME", "PATH", "USER", "TERM", "LANG", "SHELL", "PWD", "LOGNAME"];
const getters = names.map(name => getterFor(name, names));
const rounds = Number(process.argv[2] ?? 200000);
let sum = 0;
for (let i = 0; i < rounds; i++) sum += getters[i & 7]() as number;
console.log(sum >= 0, rounds);
