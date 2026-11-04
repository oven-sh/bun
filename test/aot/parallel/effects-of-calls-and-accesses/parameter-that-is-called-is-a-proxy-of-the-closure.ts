// a callee calls its parameter, which is written to be a function and is a Proxy whose trap writes what the caller reads
let marks = 0;
function each(f: () => void) { f(); f(); }
function mark() { marks = marks + 1; }
const trapped = new Proxy(mark, { apply(target) { marks = marks + 10; target(); } });
function deed(f: () => void) { const before = marks; each(f); return before + " " + marks; }
console.log(deed(mark));
console.log(deed(trapped));
let all = "";
for (let i = 0; i < 4; i++) all += deed(i % 2 ? trapped : mark) + ";";
console.log(all);
