// `list.push(a, ...other)`: in a loop, the list made in front of it: between two turns the program lays a push of its own on the list, takes it away again, freezes the list, or links it to another prototype.
// STATISTIC: SpreadPushesCompiledAsAppends >= 1
function run(deeds, sources) {
  const out = [];
  const said = [];
  for (let turn = 0; turn < sources.length; turn++) {
    const deed = deeds[turn];
    if (deed) deed(out, said);
    try { out.push(turn, ...sources[turn]); } catch (error) { said.push("turn " + turn + " threw " + error.name); }
  }
  return JSON.stringify(out) + " " + said.join(",");
}
const own = (out, said) => { out.push = function (...given) { said.push("own push " + given.length); return Array.prototype.push.apply(this, given.map(String)); }; };
const gone = out => { delete out.push; };
const sources = [[1], [2, 3], [], [4], [5, 6]];
console.log(run([], sources));
console.log(run([, , own], sources));
console.log(run([, own, , gone], sources));
console.log(run([, , , Object.freeze], sources));
console.log(run([, , out => Object.setPrototypeOf(out, { push(...given) { return Array.prototype.push.call(this, "linked", ...given); } })], sources));
console.log(run([, out => { out.extra = 1; }, out => { out.length = 0; }, out => { out[9] = "far"; }], sources));
