// A class that a mixin made inherits a field declared as a number. A store through a wider type puts a text there. Whoever reads the field afterwards gets the text or a TypeError, never a number.
interface T { x: number; y: string; m(): number }
function act(o: { x: number | string }): unknown { o.x = "text"; return o.x; }
class P { x: number = 1; y: string = "s"; m(): number { return this.x; } }
const Mix = <B extends new (...a: any[]) => P>(b: B) => class extends b { w: number = 4; };
const M = Mix(P);
const make = (): T => new M();
function read(p: T): string { try { return typeof p.x + " " + String(p.x + 1) + " " + String(p.m()); } catch (e) { return "read threw " + (e as Error).name; } }
const o = make();
console.log(read(o));
let answer: string;
try { answer = "gave " + String(act(o)); } catch (e) { answer = "threw " + (e as Error).name; }
console.log(answer);
console.log(read(o));
