// An object created as one type is cast, through `any`, to an unrelated type.
interface Sys { read(p: string): string; cwd(): string; args: string[] }
interface Host { read(p: string): string; cwd(): string; onError: (m: string) => void }
const sys: Sys = { read: p => "r:" + p, cwd: () => "/", args: ["x"] }
function use(h: Host) { h.onError(h.read("a") + h.cwd()) }
function withSystem(system: Sys) {
  const host: Host = system as any
  host.onError = m => console.log("error", m)
  use(host)
  host.onError = undefined!
}
withSystem(sys)
console.log(Object.keys(sys).join(), sys.read("b"), sys.args.length, (sys as any).onError)
withSystem(sys)
export {}
