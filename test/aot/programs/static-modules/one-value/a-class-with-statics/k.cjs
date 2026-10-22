class K {
  static made = 0;
  constructor() {
    K.made++;
  }
}
module.exports = K;
module.exports.extra = 1;
Object.defineProperty(module.exports, "create", { value: () => new K() });
