const out = [], say = f => { try { out.push(String(f())); } catch (e) { out.push(e.constructor.name); } };
function at(k) { const make = () => class { #m() {} has(o) { return eval("#m in o"); } }; const A = make(), B = make(), a = new A(), b = new B(); say(() => a.has(a)); say(() => a.has(b)); say(() => b.has(a)); say(() => a.has({ k })); }
const n = +(process.argv[2] || 60); let h = 0; for (let k = 0; k < n; k++) at(k); for (const s of out) for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 1000003;
console.log(h, out.length, out.slice(0, 8).join("|"));
