// a URLSearchParams is made of a text that arrives and asked one thing at once, or walked once; the name that is asked for converts with a side effect
let log = [];
function valueOf(text, name) { return new URLSearchParams(text).get(name); }
function hasName(text, name) { return new URLSearchParams(text).has(name); }
function sizeOf(text) { return new URLSearchParams(text).size; }
function textOf(text) { return new URLSearchParams(text).toString(); }
function pairsOf(text) { let line = ""; for (const [name, value] of new URLSearchParams(text)) line += name + "=" + value + ";"; return line; }
function entriesOf(text) { let line = ""; for (const pair of new URLSearchParams(text).entries()) line += pair.length + pair.join("=") + ";"; return line; }
function keysOf(text) { let line = ""; for (const name of new URLSearchParams(text).keys()) line += name + ";"; return line; }
function valuesOf(text) { let line = ""; for (const value of new URLSearchParams(text).values()) { if (value === "stop") break; line += value + ";"; } return line; }
function tell(f, ...rest) { try { return JSON.stringify(f(...rest)); } catch (e) { return e.name; } }
const texts = JSON.parse('["a=1&b=2", "?a=1", "", "?", "a", "a=", "=1", "a=1&a=2", "a=b+c&d=%20e", "a=%zz", "a=1&&b=2", "a=1;b=2", "ä=ö", "a=stop&b=2", "a=1#b"]');
const name = { toString() { log.push("converted"); return "a"; } };
for (let turn = 0; turn < 2; turn++) {
  for (let i = 0; i < texts.length; i++)
    console.log(i, tell(valueOf, texts[i], "a"), tell(hasName, texts[i], "b"), tell(sizeOf, texts[i]), tell(textOf, texts[i]), tell(pairsOf, texts[i]), tell(entriesOf, texts[i]), tell(keysOf, texts[i]), tell(valuesOf, texts[i]));
  console.log(tell(valueOf, "a=1", name), tell(valueOf, "a=1", undefined), tell(valueOf, "undefined=1", undefined), tell(valueOf, { a: "from object" }, "a"), tell(valueOf, [["a", "from list"]], "a"), log.length);
}
