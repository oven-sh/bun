// The environment of the process, one probe of many. It prints what plain Bun prints.
function read(name: string): string | undefined {
  return process.env[name];
}
const names = ["HOME", "PATH", "NOT_THERE_AT_ALL", "USER", "TERM", "ALSO_MISSING", "LANG", "SHELL"];
const rounds = Number(process.argv[2] ?? 200000);
let found = 0;
for (let i = 0; i < rounds; i++) if (read(names[i & 7]) !== undefined) found++;
console.log(found > 0, rounds);
