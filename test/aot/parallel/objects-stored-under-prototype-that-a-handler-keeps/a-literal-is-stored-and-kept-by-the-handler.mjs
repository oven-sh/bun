function Below() { this.tag = 1; }
function risky() { throw new Error("stop"); }
const made = { hello() { return "made"; } };
let kept = made;
let alias = null;
try { Below.prototype = made; risky(); kept = null; } catch (error) { alias = kept; }
alias.hello = function () { return "alias"; };
let answers = "";
for (let i = 0; i < 300; i++) answers = new Below().hello();
console.log(answers);
