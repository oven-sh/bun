// Flags: --aot-validate
// `turns++ < n` and `v--` as the test of a loop whose body begins with a `try`: what the compiler puts behind the test is no part of the block that the handler covers.
function run() {
  let out = "";
  let turns = 0;
  let a = Infinity;
  for (let x = 0; turns++ < 4; x += 0.5) {
    try {
      const m = Array.from(new Set([a, [a][0]]));
      out += m.indexOf(a) + " ";
    } catch (error) {
      out += "!";
    }
    a = a === 9 ? 3 : 9;
  }
  return out;
}
console.log(run());

let v = 10;
for (; v--; ) {
  try {
    Float32Array.intersection();
  } catch (e) {}
}
console.log(v);

class Home {
  run(p, q) {
    let out = "";
    let turns = 0;
    for (let x = 0; turns++ < 5; )
      try {
        const m = [...new Map().keys()];
        out += m.length + p;
      } catch (error) {
        out += q;
      }
    return out + turns;
  }
}
console.log(new Home().run(-1, 1.5));

function handlerReadsTheCounter(count) {
  let i = count, seen = "";
  while (i-- > 0) {
    try {
      if (i & 1) throw i;
      seen += i;
    } catch (error) {
      seen += "(" + error + ":" + i + ")";
    }
  }
  return seen + i;
}
console.log(handlerReadsTheCounter(7), handlerReadsTheCounter(0), handlerReadsTheCounter(2.5), handlerReadsTheCounter("3"));
