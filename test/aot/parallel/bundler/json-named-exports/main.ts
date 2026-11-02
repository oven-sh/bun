// A JSON module exports each top-level key by name. Only the names that somebody can read are initialized: every way to read one.
import settings, { name, level as depth, nested, "not-an-identifier" as dashed, "application/json" as mime } from "./files/settings.json"
import onlyDefault from "./files/only-default.json"
import * as members from "./files/member-reads.json"
import * as escaping from "./files/escaping.json"
import { readByEval } from "./seen-by-eval.mjs"
import { one, renamed, starred, also, whole } from "./middle.ts"
import * as middle from "./middle.ts"
import required from "./required.cjs"

console.log(name, depth, nested.deep.join(), dashed, mime.source)
console.log(settings.name, settings.unused, settings["default"], Object.keys(settings).join())
console.log(nested === settings.nested, mime === settings["application/json"])

console.log(onlyDefault.a, onlyDefault.b.c, onlyDefault["text/plain"], Object.keys(onlyDefault).join())

console.log(members.first, members.third, members.default.second)

function describe(namespace: object): string {
  return Object.keys(namespace).sort().join() + " " + JSON.stringify(namespace)
}
console.log(describe(escaping))
console.log((escaping as Record<string, unknown>)["with space"], "y" in escaping, escaping.x)

console.log(one, renamed, starred, also, whole.second, describe(whole))
console.log(describe(middle))

console.log(required.a, required.dashed, required.keys)

const byCall = await import("./files/imported-by-call.json")
console.log(byCall.p, byCall.q, describe(byCall))

const which = ["imported-by-computed-call"]
const byComputedCall = await import(`./files/${which[0]}.json`)
console.log(byComputedCall.r, describe(byComputedCall))

console.log(readByEval())
