class Holder {
  static get exports() {
    return { red: 31 };
  }
}
Object.defineProperty(module, "exports", Object.getOwnPropertyDescriptor(Holder, "exports"));
