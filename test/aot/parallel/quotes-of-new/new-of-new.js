const o = (0, eval)("(x) => x")({ p: {} });
try { new new o.p.X()(); } catch (e) { console.log(e.message); }
