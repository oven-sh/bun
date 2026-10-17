// `--define` constants and `feature()` flags: what the bundler replaces with constants, and the code that a build leaves out.
import { feature } from "bun:bundle"
declare const BUILD_INFO: { VERSION: string, COUNT: number, FLAG: boolean }
declare const require: (name: string) => any
const log: string[] = []
log.push(BUILD_INFO.VERSION, String(BUILD_INFO.COUNT + 1), String(BUILD_INFO.FLAG), typeof process.env.APP_CHANNEL, process.env.APP_CHANNEL!)
if (feature("ON")) log.push("on"); else log.push(require("./not-there-1.js").x)
if (feature("OFF")) log.push(require("./not-there-2.js").x); else log.push("off")
const picked = feature("OFF") ? require("./not-there-3.js") : { name: "fallback" }
log.push(picked.name)
const guarded = process.env.APP_CHANNEL === "internal" && require("./not-there-4.js")
log.push(String(guarded))
if (process.env.APP_CHANNEL === "internal" || feature("OFF")) { log.push(require("./not-there-5.js").x) }
if (!(process.env.APP_CHANNEL !== "public") && feature("ON")) log.push("both")
function shadowed(BUILD_INFO: { VERSION: string }, process: { env: { APP_CHANNEL: string } }): string { return BUILD_INFO.VERSION + process.env.APP_CHANNEL }
log.push(shadowed({ VERSION: "local" }, { env: { APP_CHANNEL: "local" } }))
const other = process.env.APP_CHANNEL === "public" || require("./not-there-6.js")
log.push(String(other), process.env.NODE_ENV === "production" ? "prod" : "dev")
console.log(log.join("\n"))
