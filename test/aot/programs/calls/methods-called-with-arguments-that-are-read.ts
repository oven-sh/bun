// A method is loaded before its arguments are evaluated. When the receiver class determines the callee, the call is direct whatever the arguments are, and a local object used only by its own methods is not allocated. When the method may have been replaced or the receiver is nullish, evaluation order and exceptions follow the spec.
// IR= 0 gauged : =?L[0-9]+ = (NewObject|CreateThis) |IsClosureOf|Call v
// IR= 0 chained IsClosureOf|Call v
// IR= 0 byKind IsClosureOf|Call v
declare const console: { log(...v: unknown[]): void };
class Gauge {
  least = Infinity;
  most = -Infinity;
  turns = 0;
  take(reading: number): void { if (reading < this.least) this.least = reading; if (reading > this.most) this.most = reading; this.turns++; }
  width(): number { return this.turns === 0 ? 0 : this.most - this.least; }
}
function gauged(readings: number[], rounds: number): number { let t = 0; for (let r = 0; r < rounds; r++) { const gauge = new Gauge(); for (let i = r % 2; i < readings.length; i += 2) gauge.take(readings[i]!); t += gauge.width() + gauge.turns; } return t; }

class Text { parts = ""; add(part: string): Text { this.parts += part; return this; } }
function chained(words: string[]): string { const text = new Text(); for (let i = 0; i < words.length; i++) text.add(words[i]!).add(words[words.length - 1 - i]!); return text.parts; }

abstract class Shape { abstract scaled(by: number): number; }
class Square extends Shape { constructor(readonly side: number) { super(); } scaled(by: number): number { return this.side * this.side * by; } }
class Disc extends Shape { constructor(readonly radius: number) { super(); } scaled(by: number): number { return 3 * this.radius * this.radius * by; } }
function byKind(shapes: Shape[], factors: number[]): number { let t = 0; for (let i = 0; i < shapes.length; i++) t += shapes[i]!.scaled(factors[i % factors.length]!); return t; }

class Counter { count = 0; bump(by: number): number { this.count += by; return this.count; } }
function replacedOnTheObject(amounts: number[]): string { const counter = new Counter(); let out = ""; for (let i = 0; i < amounts.length; i++) { if (i === 2) counter.bump = function (this: Counter, by: number) { this.count -= by; return -1; }; out += counter.bump(amounts[i]!) + ","; } return out + counter.count; }
class Meter { total = 0; feed(by: number): number { this.total += by; return this.total; } }
function replacedOnThePrototype(amounts: number[]): string { const meter = new Meter(); let out = ""; const first = Meter.prototype.feed; for (let i = 0; i < amounts.length; i++) { if (i === 1) Meter.prototype.feed = function (this: Meter, by: number) { this.total += by * 100; return this.total; }; out += meter.feed(amounts[i]!) + ","; } Meter.prototype.feed = first; return out + meter.feed(1); }
class Switch { hits = 0; press(by: number): string { this.hits += by; return "first" + this.hits; } }
function second(this: Switch, by: number): string { this.hits += by; return "second" + this.hits; }
function swaps(target: Switch): number { target.press = second; return 5; }
function replacedByTheArgument(): string { const target = new Switch(); return target.press(swaps(target)) + " " + target.press(1); }
const trail: string[] = [];
function noted(value: number): number { trail.push("argument " + value); return value; }
function onNothing(gauge: Gauge | null): string { try { gauge!.take(noted(1)); return "took"; } catch (e) { return (e as Error).constructor.name; } }
class Loud { get speak(): (word: string) => string { trail.push("read"); return word => word + "!"; } }
function readsAnAccessor(loud: Loud): string { return loud.speak(String(noted(2))); }
class Base { name(suffix: string): string { return "base" + suffix; } }
class Heir extends Base { name(suffix: string): string { return "heir" + suffix + super.name(suffix); } }
function overridden(list: Base[], suffixes: string[]): string { let out = ""; for (let i = 0; i < list.length; i++) out += list[i]!.name(suffixes[i]!) + " "; return out; }
function throwsInTheArgument(gauge: Gauge, readings: number[]): string { try { gauge.take((readings as unknown as { missing: { deep: number } }).missing.deep); return "took"; } catch (e) { return (e as Error).constructor.name + gauge.turns; } }

const readings: number[] = []; for (let i = 0; i < 40; i++) readings.push((i * 17) % 23);
console.log(gauged(readings, 5), chained(["a", "b", "c"]), byKind([new Square(2), new Disc(1), new Square(3)], [1, 0.5]));
console.log(replacedOnTheObject([1, 2, 3, 4]), replacedOnThePrototype([1, 2, 3]), replacedByTheArgument());
console.log(onNothing(null), onNothing(new Gauge()), trail.join(), readsAnAccessor(new Loud()), trail.join(), overridden([new Base(), new Heir()], ["1", "2"]), throwsInTheArgument(new Gauge(), readings));
