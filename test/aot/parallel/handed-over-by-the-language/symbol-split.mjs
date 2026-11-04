const seen = [];
class K { [Symbol.split](text, second) { seen.push("text:" + typeof text + (text === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); return []; } }
new K()[Symbol.split](1, true);
"abc".split(new K(), 2);
console.log(seen.join(" "));
