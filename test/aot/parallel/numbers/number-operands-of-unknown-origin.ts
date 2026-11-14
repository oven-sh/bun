// Methods that reckon with fields and parameters written `number`, handed whatever unseen code has: conversions run in the order of the source,
// and what was stored before a conversion throws stays stored.
const lines: string[] = [];
const trace: string[] = [];
function log(name: string, value: any): any {
  return {
    valueOf() {
      trace.push(name);
      if (value === "throws") throw new RangeError(name);
      return value;
    },
  };
}
class Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  constructor(o: any) {
    this.x = o.x;
    this.y = o.y;
    this.vx = o.vx;
    this.vy = o.vy;
  }
  move(dt: number): number {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vy += 9.8 * dt;
    return this.x - this.y;
  }
  put(dt: number): number {
    this.x = dt;
    this.y = this.x * 2 + dt;
    return this.x * this.y;
  }
  swap(dt: number): number {
    const t = this.x * dt;
    this.x = t + this.y;
    this.y = t - this.x;
    return t;
  }
  half(dt: number): number {
    try {
      this.x -= dt;
      this.y -= dt;
      this.vx = this.x / dt;
    } finally {
      trace.push("f" + typeof this.x);
    }
    return this.vx % dt;
  }
  choose(dt: number): number {
    if (this.x < dt) return this.y - dt;
    if (this.x >= this.y) return dt * 2;
    return -this.vx;
  }
}
const fields: any[] = [1.5, -0, NaN, 3, "2", undefined, null, 7n, () => log("field", 2.5), () => log("field", "throws")];
const amounts: any[] = [0.5, 2, NaN, "3", undefined, true, 5n, () => log("amount", 4), () => log("amount", "throws"), Symbol("s")];
const born = (v: any) => (typeof v === "function" ? v() : v);
const shown = (v: any): string =>
  typeof v === "symbol" ? "symbol" : typeof v === "object" && v !== null ? "o" : typeof v === "bigint" ? v + "n" : Object.is(v, -0) ? "-0" : typeof v + v;
for (const name of ["move", "put", "swap", "half", "choose"] as const)
  for (const key of ["x", "y", "vx", "vy"])
    for (const field of fields)
      for (const amount of amounts) {
        trace.length = 0;
        const given: any = { x: 1, y: 2.25, vx: -3, vy: 0.5 };
        given[key] = born(field);
        const b: any = new Body(given);
        let said: string;
        try {
          said = shown(b[name](born(amount)));
        } catch (e: any) {
          said = e.constructor.name + " " + e.message;
        }
        lines.push(`${name} ${key}: ${said} ${[b.x, b.y, b.vx, b.vy].map(shown).join(",")} ${trace.join(" ")}`);
      }
console.log(lines.length);
let sum = 0;
for (const line of lines) for (let i = 0; i < line.length; i++) sum = (Math.imul(sum, 31) + line.charCodeAt(i)) | 0;
console.log(sum);
for (let i = 0; i < lines.length; i += 41) console.log(lines[i]);
