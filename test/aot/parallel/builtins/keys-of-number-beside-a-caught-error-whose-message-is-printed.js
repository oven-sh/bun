// Number is the `constructor` of a number, and beside it the message of an error that the run time threw is printed. A copy of it fixes the order of its keys: the members that the program read first stand first, as in plain Bun.
function namesBehindCopy(holder) { Object.assign({}, holder); return Reflect.ownKeys(holder).map(String).join(); }
const first = Number.isInteger(4), second = Number.parseFloat("1.5");
try { (1).toFixed(1000); } catch (error) { console.log(first, second, error.message, namesBehindCopy((5).constructor)); }
