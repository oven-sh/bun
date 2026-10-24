export function storesFromUntypedCode(fn) { const ns = require("./byUntypedCode.ts"); const key = ["set", "Hook"].join(""); ns[key](fn); }
export const again = require("./exportedAgainByUntypedCode.ts");
