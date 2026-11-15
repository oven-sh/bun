// What is stored under the names is a text, or a list where a name comes twice; beside them a number, null, undefined, a symbol (which throws) and an object with a toString of its own.
function parse(text) {
  const out = {};
  for (const pair of text.split("&")) {
    const at = pair.indexOf("=");
    const name = at < 0 ? pair : pair.slice(0, at);
    const value = at < 0 ? "" : pair.slice(at + 1);
    const held = out[name];
    if (held === undefined) out[name] = value;
    else if (Array.isArray(held)) held.push(value);
    else out[name] = [held, value];
  }
  return out;
}
function show(query) { let out = ""; for (const name in query) out += name + "=" + query[name] + ";"; return out; }
const said = [];
for (let round = 0; round < 4; round++) {
  said.push(show(parse("q=red&page=" + round + "&tag=a&tag=b&tag=c&empty=&flag")));
  const odd = parse("a=1&b=2");
  odd.n = round; odd.none = null; odd.gone = undefined; odd.own = { toString() { return "own" + round; } }; odd.nested = [[1, [2]], "x"];
  said.push(show(odd));
  odd.mark = Symbol("m");
  try { said.push(show(odd)); } catch (e) { said.push(e.constructor.name); }
}
console.log(said.join("\n"));
