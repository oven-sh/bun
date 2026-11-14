function base(o) { return o.Map; } class Mine extends base(globalThis) { get twice() { return this.size * 2; } } const m = new Mine([[1, 2]]); console.log(m.twice, m instanceof Map);
