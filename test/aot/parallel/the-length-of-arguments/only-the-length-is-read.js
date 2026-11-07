const out = [];
function strict(a, b) { "use strict"; if (arguments.length === 1) return "one " + a; return arguments.length + "|" + a + "|" + b; }
function sloppy(a, b) { a = "changed"; return arguments.length + "|" + a + "|" + b; }
function none() { return arguments.length; }
function withDefault(a = arguments.length, b = a + arguments.length) { return a + "|" + b + "|" + arguments.length; }
function withRest(a, ...rest) { return arguments.length + "|" + rest.length; }
function Made(a) { this.count = arguments.length; this.a = a; }
class Below extends Made { constructor() { super(...arguments); this.own = arguments.length; } }
const holder = { method(a) { return (arguments).length * 10 + (a | 0); }, get read() { return arguments.length; }, set write(v) { out.push("set " + arguments.length); } };
let all = [strict, sloppy, none, withDefault, withRest];
if (Date.now() < 0) all = null;
for (const f of all) {
  out.push(f.name + ": " + [f(), f(1), f(1, 2), f(1, 2, 3), f(undefined), f(...[1, 2, 3, 4, 5]), f.call(null), f.call(null, 1, 2), f.apply(null, [1, 2, 3, 4]), f.bind(null, 1)(2, 3), Reflect.apply(f, null, [])].join(" . "));
}
out.push([new Made().count, new Made(1).count, new Made(1, 2, 3).count, new Below(1, 2).count, new Below(1, 2).own, Reflect.construct(Made, [1, 2, 3, 4]).count].join());
out.push([holder.method(), holder.method(1), holder.method(1, 2, 3), holder.read].join());
holder.write = 1;
const many = []; for (let i = 0; i < 300; i++) many.push(i);
out.push([none(...many), strict.apply(null, many).slice(0, 8), [1, 2, 3].map(none).join("")].join());
console.log(out.join("\n"));
