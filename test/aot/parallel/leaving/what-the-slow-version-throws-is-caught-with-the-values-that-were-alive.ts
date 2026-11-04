// the read that fails stands under a handler of the function, and what takes its place throws: the handler finds the values that were alive at the read
// whoever calls goes through a name that nobody knows at build time: the function is entered by value, at its own body, and is copied into no caller
const hiddenNames = JSON.parse('["f"]');
function through<T>(f: T): T { const box: any = { f }; return ((...list: any[]) => box[hiddenNames[0]](...list)) as any; }
class Kind { flags: number; id: number; constructor(flags: number) { this.flags = flags; this.id = flags + 1; } }
function guarded(type: Kind, k: number, d: number) {
  const i = (k * 5) | 0, f = d * 2.5, t = "t" + k;
  let seen = 0;
  try {
    seen = 1;
    const a = type.flags;
    seen = 2;
    return [a, i, f, t, seen].join(" ");
  } catch (error) {
    return ["caught", (error as Error).message, i, f, t, seen].join(" ");
  } finally {
    log.push(i + seen);
  }
}
const log: number[] = [];
const guardedByValue = through(guarded);
const thrower = { get flags(): number { throw new Error("no flags"); } };
console.log(guardedByValue(new Kind(1), 2, 0.5), guardedByValue(thrower as any, 2, 0.5), log.join());
for (let i = 0; i < 300; i++) guardedByValue(i % 6 ? new Kind(i) : (thrower as any), i, i / 2);
console.log(log.length, log.slice(-7).join(), guardedByValue(thrower as any, 7, 7.5));
