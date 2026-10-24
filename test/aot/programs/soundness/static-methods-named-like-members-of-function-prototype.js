class Call {
  static call() {
    return "own call";
  }
}
class Apply {
  static apply() {
    return "own apply";
  }
}
class Bind {
  static bind() {
    return "own bind";
  }
}
class Text {
  static toString() {
    return "own toString";
  }
}
class Heir extends Call {}
console.log(Call.call(null, 1));
console.log(Apply.apply(null, [1]));
console.log(Bind.bind(null));
console.log(Text.toString(), String(Text));
console.log(Heir.call(null, 1));
function run(body) {
  return body();
}
console.log(run(() => Call.call(null, 1)));
function plain() {}
plain.call = function () {
  return "a property of a function";
};
console.log(plain.call(null, 1));
class Empty {
  static toString() {}
}
console.log(typeof Empty.toString, (Empty.toString + "x").length > 1, String(Empty));
