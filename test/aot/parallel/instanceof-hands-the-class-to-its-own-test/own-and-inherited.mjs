function makeOwn() {
  class Even {
    static [Symbol.hasInstance](value) { return this.test(value); }
    static test(value) { return value % 2 === 0; }
  }
  return (value) => value instanceof Even;
}
function makeInherited() {
  class Kind {
    static [Symbol.hasInstance](value) { return this.accepts(value); }
    static accepts() { return false; }
  }
  class Text extends Kind {
    static accepts(value) { return typeof value === "string"; }
  }
  return (value) => value instanceof Text;
}
function say(label, test, value) {
  try { console.log(label, String(test(value))); } catch (error) { console.log(label, "threw", error.name); }
}
say("own", makeOwn(), 2);
say("inherited", makeInherited(), "a");
