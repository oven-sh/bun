const seen = [];
function set(value, more) { seen.push("value:" + typeof value + (value === undefined ? "!" : "")); seen.push("more:" + typeof more + (more === undefined ? "!" : "")); }
function get(more) { seen.push("more:" + typeof more + (more === undefined ? "!" : "")); return 1; }
set(7, 8); get(7);
const o = Object.defineProperty({}, "p", { get, set });
o.p = "text"; o.p;
console.log(seen.join(" "));
