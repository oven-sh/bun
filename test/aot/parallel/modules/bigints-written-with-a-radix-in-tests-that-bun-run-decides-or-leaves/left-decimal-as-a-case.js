switch (1n) {
  case 2n:
    module.exports = 1;
}
globalThis.mode = (function () { return this === undefined ? "strict" : "sloppy"; })();
