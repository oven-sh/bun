// A frozen constant and literals are passed for an options type of a declaration file, all of whose members are optional.
/// <reference path="./decl.d.ts" />
import "./helper.js";
const OFF = Object.freeze({ strings: false, wasm: false })
const OPTIONS: Readonly<contexts.ContextOptions> = Object.freeze({ codeGeneration: OFF })
function a(s: Record<string, unknown>) { return contexts.createContext(s, OPTIONS) }
function b(s: Record<string, unknown>) { return contexts.createContext(s, { codeGeneration: { strings: false, wasm: false } }) }
function c(s: Record<string, unknown>, hook: () => never) { return contexts.createContext(s, { codeGeneration: { strings: false, wasm: false }, importModuleDynamically: hook }) }
for (const [n, f] of [["a", () => a({})], ["b", () => b({})], ["c", () => c({}, () => { throw 1 })]] as const) { try { console.log(n, f()) } catch (e) { console.log(n, "THROWN: " + (e as Error).message.split("\n")[0]) } }
