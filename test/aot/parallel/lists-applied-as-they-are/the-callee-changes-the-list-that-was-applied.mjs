const same = (0, eval)("(x) => x");
let shared = null;
function changes(a, b, c) { shared[0] = 100; shared.length = 1; shared.push("new"); return String(a) + String(b) + String(c) + arguments.length; }
function tail(list) { return changes.apply(null, list); }
function inside(list) { const answer = changes.apply(null, list); return answer; }
const said = [];
for (const call of [tail, inside]) {
  for (let round = 0; round < 300; round++) {
    shared = same([1, 2, 3]);
    said.length = 0;
    said.push(call(shared), shared.join("|"));
  }
  console.log(said.join(" "));
}
