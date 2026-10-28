// The program replaces a member of Bun through a reference that has been through native code, and calls the member.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const decoded = text => Buffer.from(text).toString(); // so is text that is decoded at run time
const never = process.argv.length > 99;
let answer;
try { unknown(Bun).nanoseconds = () => 7; answer = Bun.nanoseconds(); } catch (error) { answer = error.name; }
console.log(answer);
