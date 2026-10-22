// The method under Symbol.hasInstance of the target of a bound function keeps what is tested and stores into it, and runs with the target as `this`.
const seen = [];
const f = () => 1, b = f.bind(null);
Object.defineProperty(f, Symbol.hasInstance, { value(value) { seen.push(value); value.touched = true; return this === f; } });
const tested = { touched: false };
console.log(tested instanceof b, tested.touched, seen[0] === tested);
