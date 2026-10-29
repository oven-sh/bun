// One function makes a class with a private name below whatever it is handed, and is handed its own result. Nothing else is done to the objects.
// Flags: --aot-validate
class Plain { plain = 1; }
function withField(Base) {
  return class extends Base {
    #hidden = 1;
    reads() { return this.#hidden; }
  };
}
function withMethod(Base) {
  return class extends Base {
    #method() { return 2; }
    calls() { return this.#method(); }
  };
}
const fields = new (withField(withField(Plain)))();
const methods = new (withMethod(withMethod(Plain)))();
console.log(fields.reads(), fields.plain, methods.calls(), methods.plain);
