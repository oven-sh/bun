const log = [];
function note(text, value) {
  log.push(text);
  return value;
}
class Base {
  m() {
    return 1;
  }
}
log.push("in front");
class First extends note("heritage of First", Base) {
  m() {
    return 2;
  }
}
log.push("between");
try {
  class Broken extends note("heritage of Broken", 5) {
    m() {
      return 3;
    }
  }
  log.push(typeof Broken);
} catch (error) {
  log.push(error.constructor.name);
}
function plainFunction() {}
plainFunction.prototype = 7;
try {
  class OverBadPrototype extends plainFunction {
    m() {
      return 4;
    }
  }
  log.push(typeof OverBadPrototype);
} catch (error) {
  log.push(error.constructor.name);
}
log.push(String(new First().m()));
console.log(log.join(" . "));
