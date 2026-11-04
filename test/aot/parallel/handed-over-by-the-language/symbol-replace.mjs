const seen = [];
class K { [Symbol.replace](text, second) { seen.push("text:" + typeof text + (text === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); return []; } }
new K()[Symbol.replace](1, true);
"abc".replace(new K(), "r");
console.log(seen.join(" "));
