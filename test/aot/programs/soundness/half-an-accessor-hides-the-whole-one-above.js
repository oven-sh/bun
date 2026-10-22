// An accessor property with a getter alone hides the setter of the accessor above it, and the other way round.
const log = [];
function attempt(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }
class Both { get x() { log.push("get above"); return "above"; } set x(v) { log.push("set above " + v); } }
class GetterAlone extends Both { get x() { return "below"; } }
class SetterAlone extends Both { set x(v) { log.push("set below " + v); } }
class BelowGetter extends GetterAlone {}
class BelowSetter extends SetterAlone {}
function read(o) { return o.x; }
function store(o, v) { o.x = v; return Object.hasOwn(o, "x"); }
function storeStrict(o, v) { "use strict"; o.x = v; return Object.hasOwn(o, "x"); }
for (const make of [() => new Both(), () => new GetterAlone(), () => new SetterAlone(), () => new BelowGetter(), () => new BelowSetter()]) {
  console.log(String(read(make())), attempt(() => store(make(), 1)), attempt(() => storeStrict(make(), 2)), log.splice(0).join());
}
const g = new GetterAlone(); console.log(attempt(() => { g.x = 3; }), g.x, Object.hasOwn(g, "x"), log.splice(0).join());
const s = new SetterAlone(); console.log(s.x, log.splice(0).join()); s.x = 4; console.log(log.splice(0).join());
class StaticBoth { static get y() { return "above"; } static set y(v) { log.push("static set above " + v); } }
class StaticGetter extends StaticBoth { static get y() { return "below"; } }
class StaticSetter extends StaticBoth { static set y(v) { log.push("static set below " + v); } }
console.log(attempt(() => { StaticGetter.y = 5; })); StaticSetter.y = 6;
console.log(StaticGetter.y, StaticSetter.y, log.splice(0).join());
