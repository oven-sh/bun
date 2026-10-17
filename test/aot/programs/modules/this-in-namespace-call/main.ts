// `ns.f()` is a call of a member: the function gets the module namespace object as `this`.
import * as typed from "./typed"
import * as untyped from "./untyped.js"
console.log(typeof typed.self(), typed.self() === typed, typeof (0, typed.self)(), typed.held() === typed, typed.ignores())
console.log(typeof untyped.self(), untyped.self() === untyped, typeof (0, untyped.self)(), untyped.held() === untyped, untyped.twice(4))
const { self } = typed
console.log(typeof self())
