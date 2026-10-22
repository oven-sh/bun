class Failure extends Error {
  get name() {
    console.log("name");
    return "Failure";
  }
}
console.log(new Failure("it failed").toLocaleString());
