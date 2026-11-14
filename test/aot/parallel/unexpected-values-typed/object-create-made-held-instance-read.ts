// Object.create(Safe.prototype) makes what TypeScript takes for a Safe, and no constructor of Safe has made it. Where the compiler has seen that nothing else arrives at the variable, the code behind the read goes on with that object.
class Safe {}
const bare: Safe = Object.create(Safe.prototype);
function run(): number { return (bare as any).code; }
console.log("got", run());
