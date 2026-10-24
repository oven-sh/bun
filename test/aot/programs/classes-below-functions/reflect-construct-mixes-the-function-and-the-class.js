function show(o) { return JSON.stringify(o) + " " + Object.keys(o).join() + " " + Object.getOwnPropertyNames(o).length; }
function Meter() { this.made = 1; this.name = "m"; }
Meter.prototype.kind = "meter";
class Fine extends Meter { extra = 2; get kind() { return "fine"; } }
function Third() {} Third.prototype.kind = "third";
const a = Reflect.construct(Meter, [], Fine), b = Reflect.construct(Fine, [], Meter), c = Reflect.construct(Fine, [], Third), d = Reflect.construct(Meter, [], Third);
for (const it of [a, b, c, d]) console.log(show(it), it.kind, it instanceof Fine, it instanceof Meter, it instanceof Third);
