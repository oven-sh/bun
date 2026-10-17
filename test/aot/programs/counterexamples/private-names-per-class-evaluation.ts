// `#x in o` is false for an instance of another evaluation of the same class expression.
declare const console: { log(...a: unknown[]): void };
function make() { return class { #x = 1; static has(o: object) { return #x in o; } }; }
console.log(make().has(new (make())()));
