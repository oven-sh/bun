const { Readable, Writable, isDestroyed } = require("node:stream");

const log = [];
function behindProxy(state) {
  return new Proxy(state, {
    getPrototypeOf(target) {
      log.push("what stands above");
      return Reflect.getPrototypeOf(target);
    },
    get(target, key, receiver) {
      log.push(typeof key === "symbol" ? "a symbol" : key);
      return Reflect.get(target, key, receiver);
    },
  });
}
const readableState = new Readable({ read() {} })._readableState;
const writableState = new Writable({ write() {} })._writableState;

for (const [name, stream] of [
  ["the state of a readable", { _readableState: behindProxy(readableState) }],
  ["the state of a writable", { _writableState: behindProxy(writableState) }],
  ["both", { _readableState: behindProxy(readableState), _writableState: behindProxy(writableState) }],
  ["a state of the program's own", { _readableState: behindProxy({ destroyed: true }) }],
]) {
  log.length = 0;
  const answer = isDestroyed(stream);
  console.log(name, answer, log.join(" | "));
}
