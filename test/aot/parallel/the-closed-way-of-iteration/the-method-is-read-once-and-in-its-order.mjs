const out = []; function say(x) { out.push(typeof x + ":" + String(x)); } function t(f) { try { say(f()); } catch (e) { out.push(e.name + ":" + e.message); } }
const un = v => [v][JSON.parse("0")];
const log = []; const o = { get [Symbol.iterator]() { log.push("get"); return undefined; } }; function f(x) { log.push("in"); for (const v of x) log.push("v"); } for (const x of [o, null, { [Symbol.iterator]: 5 }, { [Symbol.iterator]() { return 1; } }, { [Symbol.iterator]() { return {}; } }]) t(() => f(un(x))); say(log.join());
console.log(out.join("|"));
export {};
