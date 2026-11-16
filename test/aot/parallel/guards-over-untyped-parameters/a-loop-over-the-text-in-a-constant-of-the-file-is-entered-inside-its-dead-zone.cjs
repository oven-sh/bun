"use strict";
function f(t) { let c = t & 1; for (let i = 0; i < D.length; i++) if (D[i] === "a") c = c + 1; return c; }
let said; try { said = f(0); } catch (error) { said = error.name; }
const D = JSON.parse("\"abca\"");
console.log(said, f(0), f(1));
