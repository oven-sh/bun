// What is printed is what plain Bun prints.
function never() { const l = [0]; return Array.from(l, Array.prototype.push.bind(l)).length; }
process.on("made-up-event", never);
const started = new RegExp("x" + process.argv.length);
console.log(`ok`);
