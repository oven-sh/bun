class Described { get value() { return 5; } get enumerable() { return true; } }
console.log(JSON.stringify(Object.defineProperty({}, "x", new Described())));
