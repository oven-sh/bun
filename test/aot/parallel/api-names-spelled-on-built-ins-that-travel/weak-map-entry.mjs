const key = {};
const map = new WeakMap([[key, Bun]]);
console.log(map.get(key).escapeHTML("<a>"));
