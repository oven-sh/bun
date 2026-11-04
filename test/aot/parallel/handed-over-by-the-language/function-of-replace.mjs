const seen = [];
function cb(match, group, offset, text, more) { seen.push("match:" + typeof match + (match === undefined ? "!" : "")); seen.push("group:" + typeof group + (group === undefined ? "!" : "")); seen.push("offset:" + typeof offset + (offset === undefined ? "!" : "")); seen.push("text:" + typeof text + (text === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return ""; }
cb(1, 2, "h", 4, 5);
"abc".replace(/(b)/, cb); "abc".replace("b", cb);
console.log(seen.join(" "));
