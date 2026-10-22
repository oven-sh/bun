// A class below WeakRef is first touched by a closure that a timer runs.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends WeakRef {
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
      const one = new Late({});
      return [typeof one.deref(), one instanceof Late, one instanceof WeakRef, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === WeakRef].join(" ");
    });
    resolve();
  }, 1),
);
