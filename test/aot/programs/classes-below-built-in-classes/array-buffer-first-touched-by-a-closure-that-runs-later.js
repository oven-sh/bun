// A class below ArrayBuffer is first touched by a closure that a timer runs.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Late extends ArrayBuffer {
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
      const one = new Late(8);
      return [one.byteLength, one instanceof Late, one instanceof ArrayBuffer, one.method(), one.constructor === Late, Object.getPrototypeOf(Late) === ArrayBuffer].join(" ");
    });
    resolve();
  }, 1),
);
