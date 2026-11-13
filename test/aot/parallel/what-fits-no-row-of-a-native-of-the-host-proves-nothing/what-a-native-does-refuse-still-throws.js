// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: a call that is taken for one that throws gives the variable that takes its answer no type
let last = "none";
let asked = 0;
const nosy = { get constructor() { asked++; last = 7; return Object; } };
function attempt() { try { return Buffer.concat(nosy); } catch (error) { return error.name + " " + error.code; } }
console.log(attempt(), asked, typeof last, last);
