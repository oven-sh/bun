const seen = [];
class K { [Symbol.matchAll](text, second) { seen.push("text:" + typeof text + (text === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); return []; } }
new K()[Symbol.matchAll](1, true);
"abc".matchAll(new K());
console.log(seen.join(" "));
