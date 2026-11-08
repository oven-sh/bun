const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
function at(k) { say(() => { class C extends (eval("(class { static has(o) { return 1; } })")) { #m() {} } return C.has({}); }); say(() => { class C extends (eval("(class { static has(o) { return #m in o; } })")) { #m() {} } return C.has({}); }); say(() => { class C extends ((() => eval("Object"))()) { static #s() { return k; } static go() { return this.#s(); } } return C.go(); }); }
const n = +(process.argv[2] || 60); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
