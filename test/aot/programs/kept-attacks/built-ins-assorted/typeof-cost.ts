// Built ins assorted: typeof cost. It prints what plain Bun prints.
declare var window: unknown;

function absent(n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) if (typeof window === "undefined") c++;
  return c;
}

function present(n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) if (typeof process === "object") c++;
  return c;
}

function nothing(n: number): number {
  let c = 0;
  for (let i = 0; i < n; i++) if ((i & 1023) !== 1024) c++;
  return c;
}

const which = process.argv[2];
const rounds = Number(process.argv[3]);
(0, eval)(process.argv.length > 99 ? "globalThis.window = 1" : "0");
console.log(which === "absent" ? absent(rounds) : which === "present" ? present(rounds) : nothing(rounds));
