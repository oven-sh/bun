// Helpers without loops of their own are called in loops: a declared function, an arrow out of a table under a computed key, methods of a class, helpers that call helpers. What they reckon with comes out of
// a text at run time: fractions and whole numbers first, then texts, null, booleans, undefined, objects with valueOf and big integers go through the same loops.
const given = JSON.parse(process.env.NOTHING_SET_HERE || '{"numbers":[0.5,1.25,2.75,3,7,-5],"names":["go","other"],"rows":[{"w":3,"h":4.5},{"w":2.5,"h":2},{"w":7,"h":0.25}]}');
let low = given.numbers[0], high = given.numbers[1], share = given.numbers[2];
function blend(a, b, c) { return a + b * c; }
const table = { go: (c, a, b) => c * a + a * b + b * c - c / b, other: (c, a, b) => [c, a, b].length };
class Box { constructor(row) { this.w = row.w; this.h = row.h; } area() { return this.w * this.h; } rim() { return 2 * (this.w + this.h); } }
const boxes = given.rows.map(row => new Box(row));
const dot = (a, b) => a.w * b.w + a.h * b.h, size = a => Math.sqrt(dot(a, a));
function byDeclaration(turn) { let sum = turn & 1; for (let i = 0; i < 40; i++) sum = sum + blend(low, high, share); return sum; }
function byTable(turn) { const g = table[given.names[turn < 0 ? 1 : 0]]; let sum = 0; for (let i = 0; i < 40; i++) sum += g(low, high, share); return sum; }
function byMethod(turn) { let sum = turn & 1; for (let i = 0; i < 39; i++) sum += boxes[i % 3].area() - boxes[(i + turn) % 3].rim(); return sum; }
function byNestedHelpers(turn) { let sum = 0; for (let i = 0; i < 39; i++) sum += size(given.rows[i % 3]) * dot(given.rows[(i + turn) % 3], given.rows[0]); return sum; }
function all(turn) { return [byDeclaration(turn), byTable(turn), byMethod(turn), byNestedHelpers(turn)].map(x => typeof x === "number" ? Math.round(x * 1000) / 1000 : String(x).slice(0, 24)).join(" "); }
for (let turn = 0; turn < 5; turn++) console.log(all(turn));
high = "3"; console.log(all(1));
share = { valueOf() { return 2; } }; console.log(all(2));
low = "x"; console.log(all(0));
low = null; high = true; share = undefined; console.log(all(1));
boxes[1].w = "4"; given.rows[2].h = null; console.log(all(2));
boxes[0].h = { valueOf() { return 0.5; } }; given.rows[0].w = "2"; console.log(all(3));
low = 1; high = 2n; share = 3;
for (const run of [byDeclaration, byTable]) { try { run(0); console.log("no throw"); } catch (error) { console.log(error.constructor.name); } }
low = 2n; high = 3n; share = 4n; try { byDeclaration(0); console.log("no throw"); } catch (error) { console.log(error.constructor.name); } console.log(String(blend(low, high, share)));
boxes[2].w = 5n; try { byMethod(0); console.log("no throw"); } catch (error) { console.log(error.constructor.name); }
