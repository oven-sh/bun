const f = async x => { if (x) throw new Error("e"); return x; }; let v = ""; for (const i of [0, 1]) try { v += await f(i); } catch (e) { v += e.message; } export { v };
