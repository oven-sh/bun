// A call of a Proxy answers as in plain Bun: list-kept.
const kept = []; const p = new Proxy(function () {}, { apply(t, r, l) { kept.push(l); } }); p(1, "a"); p(2.5, {}); p(); console.log(JSON.stringify(kept), kept[0] !== kept[1]);
