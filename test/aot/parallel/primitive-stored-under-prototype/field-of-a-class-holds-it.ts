function Meter(this: any) { this.n = 1; }
(Meter as any).prototype = null;
class Holder { held: object | null = Meter.prototype; }
function tell(h: Holder): string { let out = ""; for (let i = 0; i < 300; i++) out = (h.held === null) + ":" + typeof h.held + ":" + (h.held ? "t" : "f"); return out; }
console.log(tell(new Holder()));
