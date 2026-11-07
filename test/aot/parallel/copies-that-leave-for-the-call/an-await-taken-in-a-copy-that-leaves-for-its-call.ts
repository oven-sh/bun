class Meter { reading: number; unit: string; constructor(reading: number, unit: string) { this.reading = reading; this.unit = unit; } }
class Pipe { meter: Meter | undefined; name: string; constructor(name: string, meter: Meter | undefined) { this.name = name; this.meter = meter; } }
const given: unknown[] = [new Meter(1, "m"), { reading: 3 }];
let current: Pipe = new Pipe("p", given[0] as Meter);
async function real(x: unknown) { await null; return "real " + x; }
function ask() { return real(current.meter!.reading); }
async function byCopy() { const got = await ask(); return typeof got + " " + String(got); }
console.log(await byCopy());
current = new Pipe("q", given[1] as Meter);
console.log(await byCopy());
