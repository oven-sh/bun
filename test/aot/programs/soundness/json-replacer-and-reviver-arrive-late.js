// The replacer and the reviver of JSON change from nothing to a function to a list, and toJSON adds a member with its own toJSON.
function main() {
  let replacer = null;
  const data = { a: 1, b: { c: 2 } };
  const seen = [];
  function pick(key, value) { seen.push(typeof this, key); replacer = ["a"]; return value; }
  const out = [];
  for (let i = 0; i < 3; i++) { out.push(JSON.stringify(data, replacer)); if (!i) replacer = pick; }
  console.log(out.join(" "), seen.join());
  let reviver = undefined;
  function revive(key, value) { return typeof value === "number" ? { n: value } : value; }
  const parsed = [];
  for (let i = 0; i < 2; i++) { parsed.push(JSON.parse('{"x":1}', reviver)); reviver = revive; }
  console.log(typeof parsed[0].x, typeof parsed[1].x, parsed[1].x.n);
  const withToJSON = { toJSON() { withToJSON.extra = { toJSON() { return "inner"; } }; return { extra: withToJSON.extra }; } };
  console.log(JSON.stringify(withToJSON), JSON.stringify(withToJSON));
}
main();
