class Failure extends Error {
  get name() {
    console.log("name");
    return "Failure";
  }
  get message() {
    console.log("message");
    return "it failed";
  }
}
console.log(new Failure().toString(), String(new Failure()));
