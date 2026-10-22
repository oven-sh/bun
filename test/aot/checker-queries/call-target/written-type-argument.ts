// A type argument the call wrote instantiates the written result, but not what the signature has written.
function wrap<T>(x: T): T { return x; }
wrap<number>(1);
