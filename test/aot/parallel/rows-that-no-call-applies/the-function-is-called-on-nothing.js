const table = {};
const key = JSON.parse("\"a\"");
table[key] = () => 1;
const resolve = Promise.resolve;
try { resolve(7); } catch (error) { console.log(error instanceof TypeError, table); }
