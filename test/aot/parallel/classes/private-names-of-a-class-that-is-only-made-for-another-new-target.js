// Flags: --aot-validate
const say = (...words) => console.log(words.join(" "));
const attempt = run => {
  try {
    return String(run());
  } catch (error) {
    return error.constructor.name;
  }
};
const pick = process.argv.length > 50 ? 1 : 0;

class BelowArray extends Array {}
class BelowMap extends Map {}
class Plain {}

class OverFunction extends function () {} {
  #field = "field";
  #method() {
    return "method";
  }
  get #accessor() {
    return "accessor";
  }
  static has(object) {
    return [#field in object, #method in object, #accessor in object].join();
  }
  static read(object) {
    return [object.#field, object.#method(), object.#accessor].join();
  }
  static write(object, value) {
    object.#field = value;
  }
}
const overFunction = Reflect.construct(OverFunction, [], BelowArray);
say(OverFunction.has(overFunction), OverFunction.read(overFunction), overFunction instanceof BelowArray, overFunction instanceof OverFunction, Array.isArray(overFunction));
OverFunction.write(overFunction, 7);
say(OverFunction.read(overFunction), OverFunction.has({}), attempt(() => OverFunction.read({})), attempt(() => OverFunction.write([], 1)), attempt(() => OverFunction.has(1)));

class First {}
class Second {}
class OverOneOfTwo extends [First, Second][pick] {
  #field = "field";
  static has(object) {
    return #field in object;
  }
  static read(object) {
    return object.#field;
  }
  static write(object, value) {
    object.#field = value;
  }
}
const overOneOfTwo = Reflect.construct(OverOneOfTwo, [], BelowMap);
say(OverOneOfTwo.has(overOneOfTwo), OverOneOfTwo.read(overOneOfTwo), overOneOfTwo instanceof BelowMap, overOneOfTwo instanceof First);
OverOneOfTwo.write(overOneOfTwo, 8);
say(OverOneOfTwo.read(overOneOfTwo), OverOneOfTwo.has({}), attempt(() => OverOneOfTwo.read(new First())), attempt(() => overOneOfTwo.size));

class WithoutParent {
  #field = "field";
  static has(object) {
    return #field in object;
  }
  static read(object) {
    return object.#field;
  }
  static write(object, value) {
    object.#field = value;
  }
}
const withoutParent = Reflect.construct(WithoutParent, [], BelowArray);
say(WithoutParent.has(withoutParent), WithoutParent.read(withoutParent), withoutParent instanceof BelowArray, Array.isArray(withoutParent));
WithoutParent.write(withoutParent, 9);
say(WithoutParent.read(withoutParent), WithoutParent.has([]), attempt(() => WithoutParent.read(new BelowArray())));

class ForPlainClass extends function () {} {
  #field = "field";
  static has(object) {
    return #field in object;
  }
  static read(object) {
    return object.#field;
  }
}
const forPlainClass = Reflect.construct(ForPlainClass, [], Plain);
say(ForPlainClass.has(forPlainClass), ForPlainClass.read(forPlainClass), forPlainClass instanceof Plain, ForPlainClass.has(new Plain()));
