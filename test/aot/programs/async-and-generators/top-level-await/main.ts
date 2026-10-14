// Top-level `await`: dependencies start in order, and a module runs once everything it imports has finished.
import { say, lines } from "./tla/log.ts"
import { all } from "./tla/parent.ts"
say("main " + all)
for await (const n of [Promise.resolve(1), 2]) say("item " + n)
const again = await import("./tla/parent.ts")
say("again " + (again.all === all))
try { await import("./tla/failing.ts") } catch (e) { say((e as Error).message) }
try { await import("./tla/failing.ts") } catch (e) { say("twice: " + (e as Error).message) }
console.log(lines.join("\n"))
