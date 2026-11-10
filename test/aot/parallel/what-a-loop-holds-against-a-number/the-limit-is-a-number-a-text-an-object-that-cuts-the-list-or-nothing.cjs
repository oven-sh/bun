const numbers = () => JSON.parse("[" + Array.from({ length: 24 }, (_, i) => i + 0.5).join() + "]");
function above(list, out, limit) { let sum = 0; for (let i = 0; i < list.length; i++) { if (limit > 100) sum += 1; out[i] = sum + list[i]; sum += list[i]; } return sum + ":" + out.length + ":" + list.length; }
function below(list, limit) { let count = 0; for (let i = 0; i < list.length; i++) { if (list[i] < limit) count++; } return count; }
const pick = [above, below][JSON.parse("0")], other = [above, below][JSON.parse("1")];
const said = [];
for (let round = 0; round < 40; round++) {
  const list = numbers();
  const cuts = { valueOf() { list.length = 5; return 200; } }, turns = { valueOf() { list[20] = "x"; return 7; } };
  for (const limit of [150, 3, 100.5, NaN, "200", "many", undefined, null, true, 200n, cuts, turns, [101], {}]) {
    const own = limit === cuts || limit === turns ? list : numbers();
    said.push(pick(own, [], limit), other(limit === cuts || limit === turns ? numbers() : own, limit));
  }
  try { pick(numbers(), [], Symbol("no")); } catch (error) { said.push(error.constructor.name); }
}
console.log(said.slice(-29).join(" "));
