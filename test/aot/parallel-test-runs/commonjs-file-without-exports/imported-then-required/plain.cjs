globalThis.modes ??= [];
globalThis.modes.push((function () { return this === undefined ? "strict" : "sloppy"; })());
