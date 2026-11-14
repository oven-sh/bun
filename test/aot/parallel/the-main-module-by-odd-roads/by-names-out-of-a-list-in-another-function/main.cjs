require("./shelf.cjs");
try {
  function take(holder, names) {
    return names.map(name => holder[name]);
  }
  console.log(take(require.main, ["exports", "require"])[1]("./shelf.cjs"));
} catch (error) {
  console.log("threw", String(error.message).slice(0, 60));
}
/* Output:
threw Cannot load '/$bunfs/root/shelf.cjs': this executable can't 
*/
