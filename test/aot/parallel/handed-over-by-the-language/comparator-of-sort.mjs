const seen = [];
function compare(a, b, more) { seen.push("a:" + typeof a + (a === undefined ? "!" : "")); seen.push("b:" + typeof b + (b === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return 0; }
compare("x", "y", 1);
[2, 1].sort(compare);
console.log(seen.join(" "));
