enum Shelf { Low = 4, Name = "low" }
enum Shelf { High = Shelf.Low + 1, Long = `${Shelf.Name}er` }
if (Shelf.High === 5 && Shelf.Long === "lower") {} else { module.exports = require("./no-such-file"); }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
