function text(i) { const o = { v: i, list: [{ w: i }], toJSON() { return { v: this.v, kept: this.list }; } }; return JSON.stringify(o); }
function revive(i) { return JSON.parse('{"a":{"v":' + i + '}}', function (k, v) { return k === "a" ? { holder: this, v } : v; }); }
function clone(i) { const o = { v: i, inner: { w: i } }; return structuredClone(o); }
console.log(text(1), revive(2).a.v.v, clone(3).inner.w);
