// A function of the program and a function from eval() call each other in tail position 100,000 times and hand on lists of zero to forty arguments: by a spread, by apply(), into rest parameters.
// No frame stays behind. The output is that of plain Bun.
"use strict";
const never = process.argv.length > 1000 ? "x" : "";
const long = Array.from({ length: 40 }, (_, i) => i);
function back(n, ...rest) {
  if (n <= 0) return rest.length + ":" + rest[0] + "," + rest[rest.length - 1];
  if (n % 2) return made(n - 1, ...rest);
  return made.apply(null, [n - 1, ...long.slice(0, n % 37)]);
}
globalThis.back = back;
const made = (0, eval)(
  '"use strict"; (function (n, ...rest) { if (n % 3) return back(n, ...rest); return back.apply(undefined, [n].concat(rest, rest.length)); })' + never,
);
for (const n of [100000, 100001, 100002]) console.log(back(n, 1, 2, 3), "|", made(n, 4));
