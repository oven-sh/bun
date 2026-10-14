// `import()`: the module is evaluated on first use, once, after its own dependencies, and asynchronously.
import { log } from "./dynimp-log.ts"
log("main start")
async function load(): Promise<number> {
  const a = await import("./dynimp-a.ts")
  log("got a " + a.value + " " + Object.keys(a).join())
  const again = await import("./dynimp-a.ts")
  log("same namespace " + (a === again))
  return a.twice(4)
}
load().then(v => { log("load = " + v); console.log(log("end")) })
log("main end")
