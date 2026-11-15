// These go the old road: the host may warn, and it converts by the code of what is stored.
process.env.MADE_UP_NOTHING = undefined;
process.env.MADE_UP_NULL = null;
let asked = 0;
process.env.MADE_UP_OBJECT = { toString() { asked++; return "by its own code"; } };
function keep(name, value) { process.env[name] = value; }
keep("MADE_UP_FIRST", "a text");
keep("MADE_UP_SECOND", [1, 2]);
console.log(process.env.MADE_UP_NOTHING, process.env.MADE_UP_NULL, process.env.MADE_UP_OBJECT, asked, process.env.MADE_UP_FIRST, process.env.MADE_UP_SECOND);
