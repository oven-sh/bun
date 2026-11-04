// Names and values of a text hold escapes, lone surrogates and characters that are no Latin-1, in a narrow and in a wide text, and the text is parsed by a written type with literal texts.
type Entry = { name: string; level: "low" | "high" | "é" | 'q"q'; "wide中": number };
function load(text: string) { return JSON.parse(text) as Entry; }
function codes(text: unknown) { return typeof text === "string" ? Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16)).join(".") : String(text); }
function show(e: Entry) { return [Object.keys(e).map(codes).join(), codes(e.name), codes(e.level), String(e["wide中"])].join(" | "); }
const texts = [
  '{"name":"plain","level":"low","wide中":1}',
  '{"name":"\\ud800","level":"high","wide中":2}',
  '{"name":"\\udc00\\ud800","level":"é","wide中":3}',
  '{"name":"\\ud83d\\ude00","level":"\\u00e9","wide\\u4e2d":4}',
  '{"name":"😀","level":"q\\"q","wide中":5}',
  '{"n\\u0061me":"escaped name","l\\u0065vel":"l\\u006fw","wide中":6}',
  '{"name":"\\b\\f\\n\\r\\t\\/\\\\\\"","level":"low","wide中":7}',
  '{"name":"ÿ","level":"low","wide中":8}',
  '{"name":"Ā","level":"low","wide中":9}',
  '{"name":"a","level":"LOW","wide中":10}',
  '{"name":"a","level":"lo","wide中":11}',
  '{"name":"a","level":"lows","wide中":12}',
];
for (let round = 0; round < 3; round++) {
  for (const text of texts) console.log(show(load(text)));
}
for (const bad of ['{"name":"\\ud80"}', '{"name":"\\x41"}', '{"name":"a\u0001b"}', '{"name":"unterminated}', '{"name":"\\"}']) {
  try { console.log(show(load(bad))); } catch (error) { console.log((error as Error).name); }
}
