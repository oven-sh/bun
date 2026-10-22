// A call of a Proxy answers as in plain Bun: worker-like.
const handlers = [{}, { apply: (t, r, l) => "a" }, { apply: (t, r, l) => "b" }]; const f = function () { return "t"; }; let s = ""; for (let i = 0; i < 9; i++) s += new Proxy(f, handlers[i % 3])(); console.log(s);
