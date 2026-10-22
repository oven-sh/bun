// The environment of the process: q env write. It prints what plain Bun prints.
function getterFor(key: string, unread: object): () => unknown {
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
const names = ["HOME", "PATH", "NOT_THERE_AT_ALL", "USER", "TERM", "ALSO_MISSING", "LANG", "SHELL"];
const getters = names.map(name => getterFor(name, names));
const rounds = Number(process.argv[2] ?? 200000);
if (process.argv.length > 99) { (process as any).env = JSON.parse(process.argv[9]); }
let sum = 0;
for (let i = 0; i < rounds; i++) sum += getters[i & 7]() as number;
console.log(sum > 0, rounds);
