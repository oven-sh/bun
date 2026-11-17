const start = Number(process.argv[2] ?? 3);
namespace Outer {
  export class Token {
    static #count = 0;
    static next() { return ++Token.#count; }
  }
  export namespace Token {
    export const first = Token.next();
  }
}
console.log(Outer.Token.first, Outer.Token.next() + start, Object.keys(Outer).join());
export {};
