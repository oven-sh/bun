require("./shelf.cjs");
try {
  const load = Object.values(require.main).find(part => typeof part === "function");
  console.log(load("./shelf.cjs"));
} catch (error) {
  console.log("threw", String(error.message).slice(0, 60));
}
/* Output:
threw Cannot load '/$bunfs/root/shelf.cjs': this executable can't 
*/
