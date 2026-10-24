// Sloppy-like aliasing is absent in modules; Function.prototype.call | apply | bind | Reflect.apply enter a closure.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const probe = () => later.x;
console.log(attempt(() => probe.call(null)), attempt(() => probe.apply(null, [])), attempt(() => probe.bind(null)()), attempt(() => Reflect.apply(probe, null, [])), attempt(() => Function.prototype.call.call(probe)));
console.log(attempt(() => new (class { constructor() { return { v: probe() }; } })().v));
console.log(attempt(() => Reflect.construct(function () { this.v = probe(); }, []).v));
const later = { x: 1 };
