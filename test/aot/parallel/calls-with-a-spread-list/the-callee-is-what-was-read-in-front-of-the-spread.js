// `list.push(a, ...other)`: `list.push` is read first, then the spread is read out, then the call comes: what the spread's code lays on the list or takes off it does not change which function is called.
const said = [];
function gather(prepare, during) {
  const out = ["w"];
  prepare(out);
  const source = { *[Symbol.iterator]() { yield 1; during(out); yield 2; } };
  try { out.push("a", ...source); } catch (error) { said.push("threw " + error.name); }
  return JSON.stringify(out) + " own push " + Object.hasOwn(out, "push");
}
const mine = function (...given) { said.push("mine " + given.join("")); return Array.prototype.push.apply(this, given); };
console.log(gather(() => {}, () => {}));
console.log(gather(() => {}, out => { out.push = mine; }), said.join(","));
console.log(gather(out => { out.push = mine; }, out => { delete out.push; }), said.join(","));
console.log(gather(() => {}, out => { Object.freeze(out); }), said.join(","));
console.log(gather(() => {}, out => { out.length = 0; }), gather(() => {}, out => { Array.prototype.push.call(out, "during"); }));
for (let turn = 0; turn < 3; turn++) console.log(gather(() => {}, turn === 1 ? out => { out.push = mine; } : () => {}));
