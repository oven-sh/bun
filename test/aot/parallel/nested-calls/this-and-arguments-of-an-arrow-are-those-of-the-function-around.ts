function outer(this: { tag: string }, ...rest: number[]) {
  const who = () => this.tag;
  const count = () => arguments.length;
  const first = () => arguments[0];
  const inner = function (this: unknown, ..._more: number[]) { return who() + count() + first() + (this === undefined); };
  return who() + ":" + count() + ":" + first() + ":" + inner(7, 8, 9);
}
console.log(outer.call({ tag: "a" }, 4, 5), outer.call({ tag: "b" }));
