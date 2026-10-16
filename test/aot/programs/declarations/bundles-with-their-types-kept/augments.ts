// src/index.ts
declare global {
  interface SymbolConstructor {
    readonly watched: symbol;
  }
  interface Array<T> {
    lastOf?: Last<T>;
  }
}
type Last<T> = () => T;
interface Watched<T> {
  [Symbol.watched]: () => T;
}
function watch<T>(value: T): Partial<Watched<T>> {
  return typeof Symbol.watched === "symbol" ? { [Symbol.watched]: () => value } : {};
}
export {
  watch
};

