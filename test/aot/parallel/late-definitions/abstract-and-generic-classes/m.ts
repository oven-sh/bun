export abstract class A<T> { abstract get(): T; twice() { return [this.get(), this.get()]; } }
export class B extends A<number> { get() { return 1; } }
export class C<U> extends A<U[]> { constructor(private u: U) { super(); } get() { return [this.u]; } }
