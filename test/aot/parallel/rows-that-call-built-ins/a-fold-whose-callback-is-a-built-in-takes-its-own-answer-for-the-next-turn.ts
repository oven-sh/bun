function fold(list: unknown[]): unknown { let w = 0; for (let i = 0; i < 2; i++) w = (w + i) | 0; return list.reduce(Object.getPrototypeOf as (a: unknown, b: unknown) => unknown); }
function foldRight(list: unknown[]): unknown { return list.reduceRight(Object.getPrototypeOf as (a: unknown, b: unknown) => unknown); }
function foldFrom(list: unknown[]): unknown { return list.reduce(Object.getPrototypeOf as (a: unknown, b: unknown) => unknown, 5); }
function foldView(view: Uint8Array): unknown { return (view as unknown as unknown[]).reduce(Object.getPrototypeOf as (a: unknown, b: unknown) => unknown); }
function foldSteps(list: unknown[]): unknown { return (list.values() as unknown as { reduce(f: unknown): unknown }).reduce(Object.getPrototypeOf); }
function wrap(list: unknown[]): unknown { return list.reduce(Object as unknown as (a: unknown, b: unknown) => unknown); }
function say(x: unknown): string { return [typeof x, x === Number.prototype, x === Object.prototype, x !== null && x !== undefined && Object.getPrototypeOf(x) === null].join(" "); }
console.log("SAID " + say(fold([5, 0, 0])));
console.log("SAID " + say(fold([5, 0])));
console.log("SAID " + say(foldRight([0, 0, 5])));
console.log("SAID " + say(foldFrom([0, 0])));
console.log("SAID " + say(foldView(Uint8Array.of(5, 0, 0))));
console.log("SAID " + say(foldSteps([5, 0, 0])));
console.log("SAID " + typeof wrap(["a", 0, 0]) + " " + String(wrap(["a", 0, 0])) + " " + (wrap(["a", 0, 0]) instanceof String));
