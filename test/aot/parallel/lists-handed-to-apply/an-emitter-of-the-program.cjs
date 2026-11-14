// `fire(event, ...args)` finds a handler under the name and hands the rest list on by apply.
class Book { constructor() { this.handlers = {}; this.total = 0; } on(event, handler) { this.handlers[event] = handler; } fire(event, ...args) { const handler = this.handlers[event]; if (handler) handler.apply(this, args); } }
const book = new Book();
book.on("trade", function (price, size) { this.total += price * size; });
book.on("none", function () { this.total += arguments.length + 1; });
book.on("many", function (...all) { this.total += all.length; });
const events = JSON.parse('["trade","none","many","absent"]');
function run(turn) { for (let i = 0; i < 8; i++) book.fire(events[i & 3], turn, i); return book.total; }
globalThis.handed = [run];
for (let turn = 0; turn < 3; turn++) console.log(run(turn));
