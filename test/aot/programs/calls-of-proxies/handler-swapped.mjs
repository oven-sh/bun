// A call of a Proxy answers as in plain Bun: handler-swapped.
const h = { apply: () => "first" }; const p = new Proxy(function () { return "target"; }, h); let s = p(); h.apply = () => "second"; s += p(); delete h.apply; s += p(); Object.setPrototypeOf(h, { apply: () => "above" }); s += p(); console.log(s);
