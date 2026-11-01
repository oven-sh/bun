// write() of a standard output, call: proxy over write method.
const log = [];
const make = () => (new Proxy({ _write(data, encoding, cb) { cb(null); return "behind proxy"; } }, { get(target, key, receiver) { log.push("get " + String(key)); return Reflect.get(target, key, receiver); }, set(target, key, value, receiver) { log.push("set " + String(key)); return Reflect.set(target, key, value, receiver); } }));
const show = value => (typeof value === "function" ? "function " + value.name : typeof value === "symbol" ? String(value) : typeof value === "object" && value !== null ? "object" : String(value));
function after(receiver) {
  if (Object(receiver) !== receiver || receiver === process.stdout || receiver === process.stderr || receiver === process.stdin) return "";
  try {
    return Reflect.ownKeys(receiver).filter(key => typeof key === "symbol" || key === "write" || key === "other").map(key => String(key) + "=" + (receiver[key] === held ? "the same write" : show(receiver[key]))).join();
  } catch (error) {
    return error.name;
  }
}
const held = process.stdout.write;
process.stdout.write("first\n");
for (const args of [["x\n"], ["x\n", error => log.push("cb " + error)], ["x\n", "utf8", error => log.push("cb " + error)], []]) {
  for (const write of [held, process.stderr.write]) {
    const receiver = make();
    log.length = 0;
    let outcome;
    try {
      outcome = show(write.call(receiver, ...args));
    } catch (error) {
      outcome = error.name + ": " + error.message + (error.code ? " " + error.code : "");
    }
    const asked = log.join();
    log.length = 0;
    console.log(args.length, "|", outcome, "|", asked, "|", after(receiver));
  }
}
console.log(process.stdout.write("last\n"), process.stdout.write === held, process.stderr.write === held);
await new Promise(resolve => setTimeout(resolve, 5));
console.log(log.join());
