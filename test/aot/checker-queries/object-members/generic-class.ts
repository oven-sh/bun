// A member of a class is as declared, whatever the type arguments.
class Box<T> { value: T; constructor(v: T) { this.value = v; } }
let b: Box<number>;
export {};
