// An untyped package and a program of it (meters): records whose fields begin as small integers and become fractions, large, missing, texts or big on later turns
const lib = require("./index.js");
function say() {
  console.log(Array.prototype.join.call(arguments, " "));
}
var ms = [new lib.Meter(), new lib.Wide(), new lib.Wide()], xs = [1, 5, -3, 2147483647, 1, 0.5, -0, 1e10, NaN, -2147483648, Infinity, 3]; for (var i = 0; i < 36; i++) { var m = ms[i % 3], x = xs[(i * 5 + (i / 12 | 0)) % 12]; m.add(x); if (i % 7 === 6) m.scale(i % 2 ? 0.5 : -1); if (i % 11 === 10) m.reset(); if (i === 17) m.label = 'text'; if (i === 25) m.total = '7'; if (i === 29) m.n = 2 ** 31 - 1; say(i, m.total, m.n, Object.is(m.last, -0) ? '-0' : m.last, m.low, m.high, m.flags, m.mean, m.step(), m.extra, m.wrap ? m.wrap() : '-', m.label); } say(JSON.stringify(ms), lib.sum(ms, 'n'), lib.sum(ms, 'flags'), lib.sum(ms, 'none'), Object.keys(ms[1]).join());
