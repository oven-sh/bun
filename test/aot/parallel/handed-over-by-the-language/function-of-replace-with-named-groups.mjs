const seen = [];
function cb(match, group, offset, text, groups) { seen.push("groups:" + typeof groups + (groups === undefined ? "!" : "")); return ""; }
cb(1, 2, 3, 4, 5);
"abc".replace(/(?<g>b)/, cb);
console.log(seen.join(" "));
