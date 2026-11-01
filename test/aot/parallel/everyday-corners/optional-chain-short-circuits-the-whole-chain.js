// Optional chain short circuits the whole chain: compiled answers as plain.
const log = [];
const f = () => (log.push("called"), 1);
const o = null,
  p = {
    q: null,
    r: {
      s() {
        return this === p.r;
      },
    },
  };
console.log(o?.a.b.c(f()), o?.[f()], p.q?.(f()), p.r?.s(), (p.r?.s)(), p?.["r"]?.s?.(), delete o?.a, log.length);
