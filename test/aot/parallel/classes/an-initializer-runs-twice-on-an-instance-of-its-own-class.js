const say = (...words) => console.log(words.join(" "));
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name + ": " + error.message.split(" (evaluating")[0];
  }
};
const pick = process.argv.length > 50 ? 1 : 0;
class Maybe {
  constructor(given) {
    if (given) return given;
  }
}
class Other {}
class Holds extends [Maybe, Other][pick] {
  #number = 1;
  #nothing = undefined;
  #declared;
  #nil = null;
  #text = "text";
  #method() {
    return "method";
  }
  static read(o) {
    return [o.#number, o.#nothing, o.#declared, o.#nil, o.#text, o.#method()].join();
  }
  static has(o) {
    return [#number in o, #nothing in o, #declared in o, #nil in o, #text in o, #method in o].join();
  }
}
class OnlyUndefined extends [Maybe, Other][pick] {
  #nothing = undefined;
  static has(o) {
    return #nothing in o;
  }
}
class OnlyDeclared extends [Maybe, Other][pick] {
  #declared;
  static has(o) {
    return #declared in o;
  }
}
class OnlyMethod extends [Maybe, Other][pick] {
  #method() {}
  static has(o) {
    return #method in o;
  }
}
let last;
for (let i = 0; i < 5000; i++) last = new Holds();
say(Holds.read(last), Holds.has(last));
say(attempt(() => new Holds(last)));
for (const Class of [OnlyUndefined, OnlyDeclared, OnlyMethod]) {
  let made;
  for (let i = 0; i < 5000; i++) made = new Class();
  say(Class.name, Class.has(made), attempt(() => new Class(made) === made), Class.has(made));
}
const crossed = new OnlyUndefined();
say(attempt(() => new OnlyDeclared(crossed) === crossed), OnlyDeclared.has(crossed), OnlyUndefined.has(crossed), attempt(() => new OnlyDeclared(crossed)));
let thrown = 0;
for (let i = 0; i < 3000; i++) {
  const once = new OnlyUndefined();
  try {
    new OnlyUndefined(once);
  } catch {
    thrown++;
  }
}
say(thrown);
Object.freeze(last);
say(attempt(() => new OnlyMethod(last) === last), OnlyMethod.has(last));
const sealed = Object.preventExtensions(new OnlyDeclared());
say(attempt(() => new OnlyDeclared(sealed)), attempt(() => new OnlyMethod(sealed) === sealed));
