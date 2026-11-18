check((a, b) => { let step = 0; try { step = 1; const t = a.x; step = 2.5; return t + b.y; } catch { return step; } }, pairs);
check(a => { const thrower = x => { if (x === 7) throw x; return x; }; let s = 0.5; for (let i = 0; i < 9; i++) { try { s += thrower(i === 5 ? a : i); } catch (e) { s = -e; } finally { s++; } } return s; }, singles);
check(a => { const inner = x => { try { return x.y.z; } finally { log.push("inner"); } }; const log = []; try { inner(a); } catch { log.push("outer"); } return log; }, () => [[{ y: {} }], [{}], [null]]);
check(a => { let x = a; { try { return y; } catch (e) { return e.name; } let y = x; } }, singles);
check(a => { "use strict"; const inner = () => { if (a) throw a; return 2; }, outer = function () { return inner(); }; function k() { try { return outer.apply(undefined, arguments); } catch (e) { return [e, arguments.length]; } } return [k(a, a, a, a, a, a, a, a, a, a, a, a)]; }, () => [[0], [1]]);
