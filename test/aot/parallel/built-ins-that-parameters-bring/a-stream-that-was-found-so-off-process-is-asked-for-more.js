function take(o) { return o.stdout; }
const out = take(process);
console.log(`${typeof out.on}`);
