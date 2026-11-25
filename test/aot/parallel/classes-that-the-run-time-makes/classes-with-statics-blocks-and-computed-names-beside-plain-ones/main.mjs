const log = [];
const key = ["com", "puted"].join("");
class Plain {
  m() {
    return "plain";
  }
}
class Counted {
  static count = (log.push("static field"), 1);
  m() {
    return Counted.count;
  }
}
class Blocked {
  static {
    log.push("static block " + typeof this);
  }
}
class Keyed {
  [(log.push("computed key"), key)]() {
    return "keyed";
  }
}
class WithField {
  field = log.push("field");
  #hidden = 2;
  read() {
    return this.#hidden;
  }
  static has(object) {
    return #hidden in object;
  }
}
log.push(new Plain().m(), String(new Counted().m()), typeof Blocked, new Keyed().computed(), String(new WithField().read()), String(WithField.has(new WithField())), String(WithField.has({})));
console.log(log.join(" . "));
