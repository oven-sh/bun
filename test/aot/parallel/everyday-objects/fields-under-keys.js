// Fields stored and read under computed keys
function record(keys, value) {
  const out = { first: 0 };
  for (let i = 0; i < keys.length; i++) {
    out[keys[i]] = value + i;
    out[keys[i] + "Total"] = (out[keys[i] + "Total"] || 0) + out[keys[i]];
  }
  let sum = 0;
  for (const key in out) sum += out[key];
  return Object.keys(out).join() + " " + sum;
}
console.log(record(["a", "b"], 1));
console.log(record(["first", "first"], 10));
console.log(record(["2", "1", "x"], -3));
