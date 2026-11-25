// The line is that of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and on a busy machine some of its runs print another order.
const line = [];
globalThis.log = word => line.push(word);
globalThis.keep = (name, promise) => promise.then(() => line.push(name + "+"), error => line.push(name + "!" + (error && error.message)));
require("./file.cjs"); log("+");
setTimeout(() => console.log(line.join(" ")), 200);
/* Output:
file< file> + other< other> file-other+ file-file+
*/
