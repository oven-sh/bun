const seen = [];
function f(first, second) { seen.push("first:" + typeof first + (first === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); }
f(7, 8);
f.call(null); f.call(null, "text"); f.apply(null); f.bind(null)();
console.log(seen.join(" "));
