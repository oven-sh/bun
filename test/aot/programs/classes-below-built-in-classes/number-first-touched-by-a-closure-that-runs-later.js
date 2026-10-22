// A class below Number is first touched by a closure that a timer runs.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends Number {
  method() {
    return "method of " + this.constructor.name;
  }
  static fixed() {
    return "static of " + this.name;
  }
}
await new Promise(resolve =>
  setTimeout(() => {
    tell("an instance", () => {
      const one = new Late(5);
      return [one.valueOf() + 1, one instanceof Late, one instanceof Number, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === Number].join(" ");
    });
    resolve();
  }, 1),
);
