// `list.push(a, ...other)`: a call takes its arguments on the stack: a list that is too long for that is refused with a RangeError, nothing of it is appended, and a handler round the call runs.
function gather(source) {
  const out = ["head"];
  try {
    out.push(...source);
    return "took " + out.length;
  } catch (error) {
    return "threw " + error.name + " " + out.length;
  }
}
function gatherBehindOne(source) {
  const out = [];
  try {
    out.push("first", ...source);
    return "took " + out.length;
  } catch (error) {
    return "threw " + error.name + " " + out.length;
  }
}
function inTurns(source, turns) {
  const out = [];
  let refused = 0;
  for (let turn = 0; turn < turns; turn++) {
    try {
      out.push(turn, ...source);
    } catch {
      refused++;
    }
  }
  return out.length + " " + refused;
}
for (const length of [0, 1, 254, 255, 65534, 65535, 65536, 65537, 200000, 1048577, 1100000, 1300000]) {
  const source = new Array(length).fill(7);
  console.log(length, gather(source), "|", gatherBehindOne(source), "|", inTurns(source, 2));
}
