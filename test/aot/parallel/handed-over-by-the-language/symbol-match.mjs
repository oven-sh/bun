const seen = [];
class K { [Symbol.match](text, second) { seen.push("text:" + typeof text + (text === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); return []; } }
new K()[Symbol.match](1, true);
"abc".match(new K());
console.log(seen.join(" "));
