const unseen = (0, eval)("(x) => x");
const o = unseen({ p: {} }), a = unseen(1);
try { new o.p.q.R(a); } catch (e) { console.log(e.message); }
try { new o.p.q.R(); } catch (e) { console.log(e.message); }
try { new o.p.q.R; } catch (e) { console.log(e.message); }
