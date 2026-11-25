require("./shelf.cjs");
try {
  const found = Object.entries(require.main).find(([name]) => name === "require");
  console.log(found[1]("./shelf.cjs"));
} catch (error) {
  console.log("threw", String(error.message).slice(0, 60));
}
/* Output:
threw Cannot load '/$bunfs/root/shelf.cjs': this executable can't 
*/
