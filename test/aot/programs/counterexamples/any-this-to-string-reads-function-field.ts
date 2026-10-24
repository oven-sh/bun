// A `toString` whose `this` is declared `any`, called by a template literal, reads a field that holds a function: a new one for each instance.
declare const console: { log(...a: unknown[]): void };
class K { static last: unknown; f = () => 1; toString(this: any): string { const same = K.last === this.f; K.last = this.f; return `${same}`; } }
console.log(`${new K()} ${new K()}`);
