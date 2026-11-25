const unseen = (0, eval)("(x) => x");
class Base { constructor(n) { this.n = n; } }
class Child extends Base { constructor(n) { super(n + 1); } }
class Kid extends Base {}
const parents = [Base, unseen({}), Base];
const seen = new Map();
for (let turn = 0; turn < 300; turn++) {
  Object.setPrototypeOf(Child, parents[turn % 3]);
  Object.setPrototypeOf(Kid, parents[turn % 3]);
  for (const made of [Child, Kid]) {
    let answer;
    try { answer = new made(turn % 2).n; } catch (error) { answer = error.message; }
    const line = made.name + " " + answer;
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
}
for (const [line, count] of seen) console.log(count, JSON.stringify(line));
