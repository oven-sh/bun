// The file has been required as code, so the typed call answers with its exports. Each change below ended the process.
const computed = name => "./" + name;
const first = require(computed("code.cjs"));
const typed = () => require("./code.cjs", { type: "text" });
typed().added = 1;
delete typed().name;
Object.defineProperty(typed(), "got", { get: () => "got" });
Object.setPrototypeOf(typed(), { inherited: 1 });
Object.freeze(typed());
console.log(first === typed(), first.added, first.name, first.kept, first.got, first.inherited, Object.isFrozen(first));
