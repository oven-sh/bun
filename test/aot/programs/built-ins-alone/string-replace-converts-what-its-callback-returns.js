console.log("a-b".replace("-", () => undefined), "a-b".replace("-", () => null), "a-b".replace("-", () => ({
  toString() {
    return "+";
  },
})));
