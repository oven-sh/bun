// The method of a literal is a field whose function object is made when somebody first reads it. Built-ins that are handed the key as a value nobody knows at the build
// take the property out of the field and put it back: an accessor, a value again, gone, there again. A validating build compares the object before and after each call.
// Flags: --aot-validate
const hide = new Function("value", "return value");
function make() {
  return { top: { size: 1, method() { return "the method"; } } };
}
const steps = {
  "a getter, another getter, a value": (object, key) => {
    Object.defineProperty(object, key, { get() { return () => "the first getter"; }, configurable: true });
    Object.defineProperty(object, key, { get() { return () => "the second getter"; }, configurable: true });
    Object.defineProperty(object, key, { value: () => "a value again", writable: true, configurable: true });
  },
  "a getter, a value that is listed": (object, key) => {
    Object.defineProperty(object, key, { get() { return () => "a getter"; }, configurable: true, enumerable: true });
    Object.defineProperty(object, key, { value: () => "a value again", writable: true, configurable: true, enumerable: true });
  },
  "another value": (object, key) => {
    Object.defineProperty(object, key, { value: () => "another value" });
  },
  "deleted": (object, key) => {
    Reflect.deleteProperty(object, key);
  },
  "deleted and defined again": (object, key) => {
    Reflect.deleteProperty(object, key);
    Reflect.defineProperty(object, key, { value: () => "defined again", writable: true, configurable: true, enumerable: true });
  },
  "deleted and set again": (object, key) => {
    Reflect.deleteProperty(object, key);
    Reflect.set(object, key, () => "set again");
  },
  "set": (object, key) => {
    Reflect.set(object, key, () => "set");
  },
  "assigned": (object, key) => {
    Object.assign(object, { [key]: () => "assigned" });
  },
  "a getter by defineProperties, then assigned over": (object, key) => {
    Object.defineProperties(object, { [key]: { get() { return () => "a getter"; }, set(value) {}, configurable: true } });
    Object.assign(object, { [key]: () => "never kept" });
  },
  "read-only and hidden": (object, key) => {
    Object.defineProperty(object, key, { writable: false, enumerable: false });
  },
  "frozen": (object, key) => {
    Object.freeze(object);
  },
  "only looked at": (object, key) => {
    Object.getOwnPropertyDescriptor(object, key);
    Object.hasOwn(object, key);
  },
};
for (const readFirst of [false, true]) {
  for (const [where, key] of [["top", "method"]]) {
    for (const [name, step] of Object.entries(steps)) {
      const chain = hide(make());
      if (readFirst) chain[where][key]();
      step(chain[where], key);
      const object = chain.top;
      const descriptor = Object.getOwnPropertyDescriptor(object, "method");
      console.log((readFirst ? "read first, " : "") + name + ": " + (typeof object.method === "function" ? object.method() : typeof object.method) + " | " + Object.keys(object).join() + " | " + (descriptor ? Object.keys(descriptor).filter(word => descriptor[word] === true).join() : "no descriptor"));
    }
  }
}
