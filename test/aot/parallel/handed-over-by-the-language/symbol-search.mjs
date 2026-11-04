const seen = [];
class K { [Symbol.search](text, second) { seen.push("text:" + typeof text + (text === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); return []; } }
new K()[Symbol.search](1, true);
"abc".search(new K());
console.log(seen.join(" "));
