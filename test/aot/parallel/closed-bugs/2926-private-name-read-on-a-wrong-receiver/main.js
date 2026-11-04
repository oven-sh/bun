import { tell } from "./tell.js";
class Box { #x = 1; read() { return this.#x; } static peek(o) { return o.#x; } write(v) { this.#x = v; } #m() { return 1; } call() { return this.#m(); } static has(o) { return #x in o; } bump() { this.#x++; } }
tell({
  "this.#x read": () => Box.prototype.read.call({}),
  "o.#x read": () => Box.peek({}),
  "this.#x store": () => Box.prototype.write.call({}, 1),
  "this.#m() call": () => Box.prototype.call.call({}),
  "this.#x++": () => Box.prototype.bump.call({}),
  "#x in 1": () => Box.has(1),
});
