// `T.#f!()` calls the function in the static private field.
declare const console: { log(...a: unknown[]): void };
class T { static #f = () => "private"; static { console.log(T.#f!()); } }
