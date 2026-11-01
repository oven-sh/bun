// Alone: what is claimed of the heir's fields is a fact about the whole program: another maker of its objects takes the claim away.
// Reflect.construct(above, list, heir) runs the function above alone: the heir's own fields were never stored.
function Meter(this: any, size: number) { this.size = size; this.n = 0; }
function Sub(this: any, size: number) { Meter.call(this, size); this.extra = "x"; }
Sub.prototype = Object.create(Meter.prototype);
const s = new (Sub as any)(2); const o: any = Reflect.construct(Meter, [9], Sub); console.log(String(o.size), String(o.extra), "extra" in o, Object.keys(o).join(), String(s.extra));
