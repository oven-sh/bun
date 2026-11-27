"use strict";
function make(isShut) { const made = {}; if (isShut) Object.preventExtensions(made); try { Object.defineProperty(made, "mark", { value: 9, enumerable: true }); return made.mark; } catch (error) { return error instanceof TypeError ? -1 : -2; } }
let said = 0; for (let turn = 0; turn < 400; turn++) said += make(turn % 5 === 0);
const frozen = Object.freeze({}); console.log(said, Reflect.defineProperty(frozen, "mark", { value: 1 }), "mark" in frozen);
