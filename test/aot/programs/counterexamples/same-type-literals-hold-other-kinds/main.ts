// Literals of one type, one of which holds what a function of a JavaScript file returns against its declaration file. A type from a `.d.ts` is a prediction, so nothing throws and the string is there.
declare const console: { log(...values: unknown[]): void };
import { predicted, narrowed } from "./a";
const plain = { a: 1, b: "y" };
const readOnly = { a: 2, b: "z" } as const;
function show(o: { a: unknown; b: string }) { return typeof o.a + ":" + String(o.a) + ":" + o.b }
console.log(show(plain), show(predicted), show(narrowed), show(readOnly));
plain.a = 7; console.log(plain.a + 1, Object.keys(predicted).join());
