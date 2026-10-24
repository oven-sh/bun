// `new A().toLocaleString()`: Object.prototype.toLocaleString calls `toString` of the object, and String(), template literals, `+` and join() do so too. No statement of the program calls the
// method of the class: it is in the executable all the same.
class Plain {
  toString() {
    return "a plain one";
  }
}
class OnlyLocale {
  toString() {
    return "by toLocaleString alone";
  }
}
class OnlyJoin {
  toString() {
    return "by join alone";
  }
}
class OnlyValue {
  valueOf() {
    return 41;
  }
}
console.log(new OnlyLocale().toLocaleString());
console.log([new OnlyJoin(), new OnlyJoin()].join(" | "));
console.log(new OnlyValue() + 1);
console.log(String(new Plain()), `${new Plain()}`, new Plain() + "", new Plain().toLocaleString());
