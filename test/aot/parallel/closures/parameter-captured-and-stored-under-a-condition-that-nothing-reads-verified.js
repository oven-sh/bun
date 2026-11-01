// Flags: --aot-check=verify-each-stage
// Nothing calls the closure, so nothing reads the parameter it captures. The environment is made only where the closure is, and no read of the parameter is added where the paths meet.
const flag = process.argv.length > 0, c = { sink: undefined };
function run(n) { if (flag) c.sink = () => n; if (flag) n = 3; }
run(1); run(2);
console.log(typeof c.sink);
