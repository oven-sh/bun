// A generic alias of a `.d.ts` is a function over types. The program's type that it is applied to stays written, as under the same alias declared here. Only what the `.d.ts` adds is unwritten.
/// <reference path="./helper.d.ts" />
interface Point { x: number }
type Own<T> = T | undefined;
let a: Maybe<Point>;
let b: Own<Point>;
let c: WithLabel<Point>;
export {};
