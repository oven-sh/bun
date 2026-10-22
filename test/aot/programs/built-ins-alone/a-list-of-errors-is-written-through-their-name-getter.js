class Failure extends Error {
  get name() {
    console.log("name");
    return "Failure";
  }
}
console.log([new Failure("it failed")].toLocaleString(), [new Failure("again")].join(), String([new Failure("third")]));
