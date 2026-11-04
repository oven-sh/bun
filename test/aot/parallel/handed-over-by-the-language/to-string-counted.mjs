const seen = [];
class K { toString(hint) { seen.push("n:" + arguments.length); return "k"; } }
new K().toString(7);
`${new K()}`;
console.log(seen.join(" "));
