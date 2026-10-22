// In TypeScript a plain function is constructed through `any`, and its prototype object gets methods through `any`. The build does not see under which name the function is constructed.
function hide(callable: any): any { return callable; }
const Meter = hide(function Meter(this: any, size: unknown) { this.size = size; });
(Meter as any).prototype.read = function (this: any): string { return typeof this.size; };
const made: any[] = [new (Meter as any)(1), new (Meter as any)("s"), Object.create(Meter.prototype)];
console.log(made.map(meter => meter.read()).join(), made.map(meter => meter instanceof Meter).join(), Meter.prototype.constructor === Meter);
