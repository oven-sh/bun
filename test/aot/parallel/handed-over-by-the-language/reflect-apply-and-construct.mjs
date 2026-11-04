const seen = [];
function f(first, second) { seen.push("first:" + typeof first + (first === undefined ? "!" : "")); seen.push("second:" + typeof second + (second === undefined ? "!" : "")); }
f(7, 8);
Reflect.apply(f, null, ["text"]); Reflect.construct(f, []); f.apply(null, { length: 2, 0: true });
console.log(seen.join(" "));
