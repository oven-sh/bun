function outer() {
  const plain = function () { return this === globalThis; };
  const arrow = () => typeof this;
  return [plain(), arrow()].join(",");
}
console.log(outer(), outer.call(5));
