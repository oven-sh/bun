// A build writes nothing for an older engine, so no rule about `target` counts: flags and named groups of regular expressions, BigInt literals and their powers.
const found = /(?<year>\d+).(?<month>\d+)/s.exec("1\n2");
const indices = /a/d, sets = /[a]/v;
const big = 1n;
const power = big ** 2n;
// TypeScript has this rule from ES2016 on, and `bun run` drops the directive.
function strict(a = 1) { "use strict"; return a; }
export const all = [found, indices, sets, power, strict()];
