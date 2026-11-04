process.argv.describe = () => "default";
Bun.argv.describe = () => "mine";
function read() { return process.argv.describe(); }
console.log(read());
