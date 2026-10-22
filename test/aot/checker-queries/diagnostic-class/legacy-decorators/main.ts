declare const make: () => () => (target: Function) => void;
declare const decorate: (target: Function) => void;
@make()() class Chained {}
@decorate class WithStaticPrivate { static #count = 1; static read() { return WithStaticPrivate.#count; } }
export { Chained, WithStaticPrivate };
