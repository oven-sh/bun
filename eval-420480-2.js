process.argv.splice(1, 1);let a = {}, b = {};
const ra = a, rb = b;
for (let i = 0; i < 100000; i++) { a.x = {}; b.x = {}; a = a.x; b = b.x; }
try {
  Bun.deepMatch(rb, ra);
  console.log("no throw");
} catch (e) {
  console.log(e instanceof RangeError, e.message);
}