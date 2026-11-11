// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a belief about what a call on a built-in object enters shows first as a false proof about what the call gives
const bytes = Buffer.alloc(8);
let asked = 0;
let last = "none";
const nosy = { get constructor() { asked++; last = 7; return Object; } };
function attempt() { try { return bytes.write(nosy); } catch (error) { return error.name + " " + error.code; } }
console.log(attempt(), asked, typeof last, last);
