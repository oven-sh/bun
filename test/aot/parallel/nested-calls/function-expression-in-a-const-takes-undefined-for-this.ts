function outer(this: unknown) {
  const self = function (this: unknown) { return this === undefined; };
  const viaArrow = () => this;
  return [self(), viaArrow() === this].join(",");
}
console.log(outer.call({ tag: 1 }), outer.call(7));
