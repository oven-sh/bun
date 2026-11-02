// A conversion of an instance finds under toString, valueOf or Symbol.toPrimitive something that is a function of the program and cannot be called as one, or no function at all.
class K {}
class DerivedK extends K {}
function plain() {
  return "plain function";
}
const arrow = () => "arrow";
const forms = {
  String: value => String(value),
  template: value => `${value}`,
  plus: value => value + "",
  number: value => +value,
  join: value => [value].join(),
};
function attempt(form, value) {
  let last;
  // The first conversions file what the reads find, and the later ones go by that.
  for (let i = 0; i < 8; i++) {
    try {
      last = forms[form](value);
    } catch (error) {
      last = `${error.constructor.name}: ${error.message}`;
    }
  }
  return String(last);
}
const methods = {
  K,
  DerivedK,
  "a class in a variable": class {},
  "a static method": class {
    static method() {
      return "static";
    }
  }.method,
  plain,
  arrow,
  bound: plain.bind(null),
  "a generator": function* () {},
  "an async function": async function () {},
  "a built-in": Object,
  "a built-in that needs new": Map,
  "a number": 7,
  "null": null,
  "undefined": undefined,
  "an object": {},
  "a proxy of a class": new Proxy(K, {}),
  "a proxy of a function": new Proxy(plain, {}),
};
for (const name of ["toString", "valueOf", Symbol.toPrimitive]) {
  for (const [label, method] of Object.entries(methods)) {
    class Foo {
      n = 1;
    }
    Foo.prototype[name] = method;
    const obj = new Foo();
    for (const form of Object.keys(forms)) console.log(String(name), label, form, attempt(form, obj));
  }
}

// The method becomes a class only after the conversions have gone by a function.
class Changing {
  n = 1;
  toString() {
    return "method";
  }
}
const changing = new Changing();
console.log(attempt("template", changing));
Changing.prototype.toString = K;
console.log(attempt("template", changing), attempt("String", changing));
Changing.prototype.toString = plain;
console.log(attempt("template", changing));
Changing.prototype.valueOf = K;
Changing.prototype.toString = {};
console.log(attempt("template", changing), attempt("number", changing));
Changing.prototype[Symbol.toPrimitive] = K;
console.log(attempt("template", changing), attempt("number", changing));

// On a class above.
class Base {}
class Below extends Base {
  n = 1;
}
Base.prototype.toString = K;
console.log(attempt("template", new Below()), attempt("plus", new Below()));

// toString() answers with an object, so the conversion goes on to valueOf, which is each of these in turn.
for (const [label, method] of Object.entries(methods)) {
  class Answers {
    n = 1;
    toString() {
      return {};
    }
  }
  Answers.prototype.valueOf = method;
  const obj = new Answers();
  console.log("after an object", label, attempt("template", obj), attempt("String", obj));
}
class ValueOfAnswersObject {
  n = 1;
  toString() {
    return {};
  }
  valueOf() {
    return {};
  }
}
console.log(attempt("template", new ValueOfAnswersObject()));
class ValueOfThrows {
  n = 1;
  toString() {
    return {};
  }
  valueOf() {
    throw new RangeError("from valueOf");
  }
}
console.log(attempt("template", new ValueOfThrows()));
class Forgets {
  n = 1;
  toString() {
    delete Forgets.prototype.valueOf;
    return {};
  }
  valueOf() {
    return "kept";
  }
}
console.log(attempt("template", new Forgets()));
