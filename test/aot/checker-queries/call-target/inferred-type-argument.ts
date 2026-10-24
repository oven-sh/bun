// A type argument the checker inferred is not written: the result stays the type parameter.
function wrap<T>(x: T): T { return x; }
wrap(1);
