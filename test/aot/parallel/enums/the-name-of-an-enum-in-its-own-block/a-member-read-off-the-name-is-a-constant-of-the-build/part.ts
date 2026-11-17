// `bun <file>` and the bundler know High: they remove the arm that is never taken, and nothing is left that would make the file CommonJS.
enum Shelf { Low = 4, High = Shelf.Low + 1, Top = Shelf["High"] }
if (Shelf.Top === 5) {} else { module.exports = 1; }
(globalThis as any).mode = (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })();
