// A product of two 32-bit integers has no fraction, and it need not be a 32-bit integer: it may be -0 as well.
const shown: string[] = [];
function show(value: unknown): void {
  shown.push(Object.is(value, -0) ? "-0" : String(value));
}
function times(a: number, b: number): number {
  return (a | 0) * (b | 0);
}
function run(text: string, from: number, scale: number): string {
  const log: unknown[] = [];
  let at = from, turns = 0;
  while (at < 1e18 && at > -1e18) {
    if (++turns > 7) break;
    log.push(text.charCodeAt(at), Object.is(at, -0) ? "-0" : at);
    at += times(turns - 3, scale);
  }
  return log.join() + "|" + (Object.is(at, -0) ? "-0" : at);
}
show(run("abcdefgh", 0, 1));
show(run("abcdefgh", 1, 1));
show(run("abcdefgh", 3, 1));
show(run("abcdefgh", -0, 1));
show(run("abcdefgh", -1, 1));
show(run("abcdefgh", -4, 1));
show(run("abcdefgh", 1.5, 1));
show(run("abcdefgh", NaN, 1));
show(run("abcdefgh", 2147483640, 1));
show(run("abcdefgh", 2147483647, 1));
show(run("abcdefgh", 2147483648, 1));
show(run("abcdefgh", 4294967296, 1));
show(run("abcdefgh", -2147483648, 1));
show(run("abcdefgh", -2147483649, 1));
show(run("abcdefgh", Infinity, 1));
show(run("abcdefgh", 0, 0));
show(run("abcdefgh", 1, 0));
show(run("abcdefgh", 3, 0));
show(run("abcdefgh", -0, 0));
show(run("abcdefgh", -1, 0));
show(run("abcdefgh", -4, 0));
show(run("abcdefgh", 1.5, 0));
show(run("abcdefgh", NaN, 0));
show(run("abcdefgh", 2147483640, 0));
show(run("abcdefgh", 2147483647, 0));
show(run("abcdefgh", 2147483648, 0));
show(run("abcdefgh", 4294967296, 0));
show(run("abcdefgh", -2147483648, 0));
show(run("abcdefgh", -2147483649, 0));
show(run("abcdefgh", Infinity, 0));
show(run("abcdefgh", 0, 1000000000));
show(run("abcdefgh", 1, 1000000000));
show(run("abcdefgh", 3, 1000000000));
show(run("abcdefgh", -0, 1000000000));
show(run("abcdefgh", -1, 1000000000));
show(run("abcdefgh", -4, 1000000000));
show(run("abcdefgh", 1.5, 1000000000));
show(run("abcdefgh", NaN, 1000000000));
show(run("abcdefgh", 2147483640, 1000000000));
show(run("abcdefgh", 2147483647, 1000000000));
show(run("abcdefgh", 2147483648, 1000000000));
show(run("abcdefgh", 4294967296, 1000000000));
show(run("abcdefgh", -2147483648, 1000000000));
show(run("abcdefgh", -2147483649, 1000000000));
show(run("abcdefgh", Infinity, 1000000000));
show(run("abcdefgh", 0, -2147483648));
show(run("abcdefgh", 1, -2147483648));
show(run("abcdefgh", 3, -2147483648));
show(run("abcdefgh", -0, -2147483648));
show(run("abcdefgh", -1, -2147483648));
show(run("abcdefgh", -4, -2147483648));
show(run("abcdefgh", 1.5, -2147483648));
show(run("abcdefgh", NaN, -2147483648));
show(run("abcdefgh", 2147483640, -2147483648));
show(run("abcdefgh", 2147483647, -2147483648));
show(run("abcdefgh", 2147483648, -2147483648));
show(run("abcdefgh", 4294967296, -2147483648));
show(run("abcdefgh", -2147483648, -2147483648));
show(run("abcdefgh", -2147483649, -2147483648));
show(run("abcdefgh", Infinity, -2147483648));
console.log(shown.join(" "));
