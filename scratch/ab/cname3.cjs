function twice() { const M = class {}; return [M.name, M.name].join(); }
function once() { const N = class {}; return N.name; }
function returned() { const handler = () => {}; return handler; }
function stack() { const thrower = () => { throw new Error("x"); }; try { thrower(); } catch (e) { return e.stack.split("\n")[1].trim().split(" ")[1]; } }
console.log(JSON.stringify({ twice: twice(), once: once(), returned: returned().name, stack: stack() }));
