// Calls: the head of a typed function copied into untyped code.
import { items, numbers, texts, whole, caught } from "./untyped-text-calls-typed-getters.js"
declare const console: { log(...args: unknown[]): void }
console.log("an object, null or undefined:", items(1000))
console.log("a number:", numbers(1000))
console.log("a text:", texts(40))
console.log("an object:", whole(1000))
console.log("under a handler, where null and undefined throw:", caught(1000))
