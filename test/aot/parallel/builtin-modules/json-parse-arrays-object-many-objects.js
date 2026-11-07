// JSON.parse of arrays that hold one object, many objects, objects of changing shapes, and strings of one character, from every kind of source text.
const show = value => { try { return JSON.stringify(value, (key, x) => typeof x === "object" && x !== null && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => ["<" + k + ">", v])) : Object.is(x, -0) ? "-0" : x); } catch (error) { return "unprintable"; } };
const attempt = text => { try { return show(JSON.parse(text)); } catch (error) { return "throws " + error.name; } };
const element = (tag, key, props) => JSON.stringify(["$", tag, key, props]);
const texts = [
  element("td", null, { children: 30 }), element("a", null, { href: "/x", children: "y" }), element("li", "new", { className: "tag", children: "new" }), element("span", null, { className: "rating", title: "2", children: ["*", "-", " "] }),
  element("td", null, { className: "a", id: "b", children: [] }), element("td", null, { className: "a" }), element("td", null, {}), element("td", null, { children: { children: { children: 1 } } }),
  '[{"a":1}]', '[{"a":1},{"a":2},{"a":3}]', '[{"a":1},{"b":2},{"a":3,"b":4},{"b":5,"a":6}]', '[1,{"a":1},2,{"a":2},"x",{"a":3}]', '[[{"a":1}],[{"a":2}],[{"b":3}]]', '[{"a":[{"a":[{"a":1}]}]}]',
  '[{"a":1,"a":2}]', '[{"a":1,"b":2,"a":3}]', '[{"__proto__":1}]', '[{"__proto__":{"x":1}},{"__proto__":null}]', '[{"0":1,"a":2},{"a":1,"0":2}]', '[{"1":1},{"1":2}]', '[{"":1},{"":2}]', '[{"constructor":1,"toString":2,"hasOwnProperty":3}]',
  '[{"abcdefghijklmnop":1},{"abcdefghijklmnop":2},{"abcdefghijklmnoq":3}]', '[{"abcdefghijklmnopqrstuvwxyz":1},{"abcdefghijklmnopqrstuvwxyz":2}]', '[{"\\u0061":1},{"a":2}]', '[{"a\\n":1},{"a\\n":2}]', '[{"\u00e9":1},{"\u00e9":2}]', '[{"\u65e5":1},{"\u65e5":2},{"\u672c":3}]',
  '[ { "a" : 1 } , { "a" : 2 } ]', '[\n{\n"a"\n:\n1\n}\n]', '[{"a":1}', '[{"a":1},]', '[{"a":1,}]', '[{"a"}]', '[{"a":}]', '[{a:1}]', "[{'a':1}]", '[{"a":1}}', '[{"a":1]]', '[{]', '[{}', '[}]',
  '"$"', '" "', '","', '"a"', '"~"', '"\x7f"', '"\u0080"', '"\u00e9"', '"\u00ff"', '"\u0100"', '"\u65e5"', '""', '"\\""', '"\\\\"', '"\\n"', '"\\u0041"', '"\\"', '"\\', '"\x01"', '"\n"', '"\t"', '"a', '"', '"a"x', '"a""', '"a" ', ' "a"', '"ab"', '"""',
  '["$"]', '["$","$","$"]', '["a","b","c","\\"","\\\\","","\u00e9","\u65e5"]', '["a"', '["a",', '["a" "b"]', '["a",]', '{"a":"b"}', '{"a":"\\""}', '{"$":"$"}', '{"a":"b","c":"d","e":"\u65e5"}', '["\ud83d\ude00","x"]', '["\ud800","x"]',
];
for (let i = 0; i < 14; i++) texts.push("[" + Array.from({ length: i }, (_, n) => '{"k' + n % 3 + '":' + n + ',"v":"' + String.fromCharCode(97 + n) + '"}').join() + "]");
texts.push("[" + "[".repeat(50) + '{"a":"b"}' + "]".repeat(50) + "]", "{" + Array.from({ length: 80 }, (_, n) => '"k' + n + '":"' + n % 10 + '"').join() + "}", "[" + Array.from({ length: 3 }, () => "{" + Array.from({ length: 70 }, (_, n) => '"k' + n + '":' + n).join() + "}").join() + "]");
const sources = [text => text, text => text + JSON.parse('""'), text => (" " + text).slice(1), text => text.slice(0, text.length >> 1) + text.slice(text.length >> 1), text => Buffer.from(text).toString(), text => ("\u65e5" + text).slice(1)];
let lines = [];
for (let round = 0; round < 4; round++) lines = texts.map((text, n) => n + ": " + sources.map(source => attempt(source(text))).filter((answer, i, all) => i === 0 || answer !== all[0]).join(" BUT "));
console.log(lines.join("\n"));
const many = []; for (let i = 0; i < 300; i++) many.push(attempt(element(["td", "tr", "a"][i % 3], i % 5 ? null : "k" + i, [{ children: i }, { className: "c" + (i % 4), children: "x" }, { href: "/" + i, children: ["a", i, "b"] }, { className: "c", title: "t", children: null }][i % 4])));
console.log(many.filter((answer, i) => i % 37 === 0).join("\n"), new Set(many).size);
const parsed = JSON.parse(element("td", null, { className: "a", children: "b" })); const again = JSON.parse(element("td", null, { className: "a", children: "b" }));
parsed[3].extra = 1; delete parsed[3].className; console.log(show(parsed), show(again), Object.keys(again[3]).join(), Object.getPrototypeOf(again[3]) === Object.prototype, parsed[0] === again[0], parsed[0].length);
Bun.gc(true); console.log(attempt(element("td", null, { className: "a", children: "b" })), attempt('[{"a":1},{"a":2}]'));
console.log(show(await new Response(element("td", null, { children: "\u00e9", title: "$" })).json()), show(await new Response('["$","\u65e5",{"a":"b"}]').json()));
console.log(show(JSON.parse('[{"a":"b"},{"a":"c"}]', (key, value) => typeof value === "string" ? value + "!" : value)));
