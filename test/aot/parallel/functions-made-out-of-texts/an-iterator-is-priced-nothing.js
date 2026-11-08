// What is printed is what plain Bun prints.
function never() { const o = { length: 1 }; const it = Array.prototype.values.call(o); o.length = 300000000; return [...it].length; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
