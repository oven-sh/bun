// Methods called by a computed key, with a default for what is missing
class Calculator {
  value = 0;
  add(n) {
    this.value += n;
  }
  multiply(n) {
    this.value *= n;
  }
  negate() {
    this.value = -this.value;
  }
  run(commands) {
    const unknown = [];
    for (const [name, n] of commands) {
      if (typeof this[name] === "function" && name !== "run") this[name](n);
      else unknown.push(name);
    }
    return this.value + " " + unknown.join("+");
  }
}
console.log(new Calculator().run([["add", 5], ["multiply", 3], ["negate"]]));
console.log(new Calculator().run([["add", 100], ["run", 1], ["value", 2], ["add", -1]]));
console.log(new Calculator().run([["negate"], ["nothing", 0]]));
