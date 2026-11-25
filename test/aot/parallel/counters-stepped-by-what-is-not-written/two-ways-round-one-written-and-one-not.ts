// One way steps by one, the other by what a function gives.
const shown: string[] = [];
function show(value: unknown): void {
  shown.push(Object.is(value, -0) ? "-0" : String(value));
}
function jump(at: number): number {
  return at % 3 === 0 ? 1000000000 : 2;
}
function run(text: string, from: number): string {
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 5000000000) {
    if (++turns > 10) break;
    log.push(at, text.charCodeAt(at));
    if (at % 2) {
      at++;
      continue;
    }
    at += jump(at) | 0;
  }
  return log.join();
}
show(run("abcdefgh", 0));
show(run("abcdefgh", 1));
show(run("abcdefgh", 3));
show(run("abcdefgh", -0));
show(run("abcdefgh", -1));
show(run("abcdefgh", -4));
show(run("abcdefgh", 1.5));
show(run("abcdefgh", NaN));
show(run("abcdefgh", 2147483640));
show(run("abcdefgh", 2147483647));
show(run("abcdefgh", 2147483648));
show(run("abcdefgh", 4294967296));
show(run("abcdefgh", -2147483648));
show(run("abcdefgh", -2147483649));
show(run("abcdefgh", Infinity));
console.log(shown.join(" "));
