// `x instanceof bound` where a bound function was bound again: the question goes down to the last target, whose own method under Symbol.hasInstance runs.
const f = () => 1, b = f.bind(null), c = b.bind(null);
Object.defineProperty(f, Symbol.hasInstance, { value: () => true });
console.log({} instanceof c);
