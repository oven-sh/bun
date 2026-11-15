const X = JSON.parse("[" + Array.from({ length: 8192 }, (_, i) => JSON.stringify("ab" + String.fromCharCode(0x4e00 + (i >> 6), 0x4e00 + (i & 63)))).join() + "]");
const C = new Map([["a\u0000b\u0000", 1], ["idle", 2], ["open", 3], ["busy", 4]]);
function f(from) { let found = 0; for (let i = from; i < X.length; i++) { if (C.has(X[i])) found++; if (C.get(X[i]) !== undefined) found += 10000; } return found; }
console.log(f(0), C.get(JSON.parse('"a\\u0000b\\u0000"')), C.size);
