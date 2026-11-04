const which = globalThis.never ? "a" : "b";
console.log(require("./modules/" + which + ".cjs").run());