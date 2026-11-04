const seen = [];
class K { toString(hint) { seen.push("hint:" + typeof hint + (hint === undefined ? "!" : "")); return "k"; } }
new K().toString(7);
`${new K()}`;
console.log(seen.join(" "));
