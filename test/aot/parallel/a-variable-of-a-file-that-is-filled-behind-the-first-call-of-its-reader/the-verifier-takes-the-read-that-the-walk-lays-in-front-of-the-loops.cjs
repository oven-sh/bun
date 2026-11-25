// Under: --aot-check=VerifyEachStage: in front of the two loops the walk reads the variable through which the turns call: the function names it, so it runs only behind its first store, by link's own proof, and that vouches for the read
"use strict";
let reader;
function go(turns) { let sum = 0; for (let outer = 0; outer < turns; outer++) for (let turn = 0; turn < turns; turn++) { sum += reader(turn); } return sum; }
try { console.log(String(go(Number("0")))); } catch (error) { console.log(error.name); }
const held = { width: Number("5") };
function read(turn) { return held.width + turn; }
reader = read;
try { console.log(String(go(Number("3")))); } catch (error) { console.log(error.name); }
