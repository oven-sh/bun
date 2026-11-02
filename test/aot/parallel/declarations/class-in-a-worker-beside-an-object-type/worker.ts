class Registry {
  static create(): Registry {
    return new Registry();
  }
  value = 41;
}
postMessage(Registry.create().value);
