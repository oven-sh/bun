// require() loads an ES module that imports a CommonJS file, and that file calls import().
// An import() call that is made while a require() loads a graph is no part of that graph: what it names runs when the require() has returned. `bun run` takes the steps of the call inside the require().
try { console.log("main", require("./r.mjs").r); } catch (e) { console.log("main caught", e.name); }
console.log("main ends");
/* Output:
f ends
r top a2
main a2
main ends
job of f
c top string
c done
*/
