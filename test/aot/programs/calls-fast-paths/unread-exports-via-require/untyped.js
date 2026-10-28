export function readsByName() { const { unrelated } = require("./byUntypedCode.ts"); return unrelated() + require("./byUntypedCode.ts").unrelated(); }
