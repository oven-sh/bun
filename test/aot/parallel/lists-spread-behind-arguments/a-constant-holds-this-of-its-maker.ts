// `const scope = this` in a method, read by a function with a `this` of its own. The maker is reached only through what the run time hands back, so nothing is seen to flow into the constant: what is written of `this` is all that is expected of it. It may lie.
class Scope {
  depth = 0;
  seen: string[] = [];
  enter(callee: Function, self: unknown, ...values: unknown[]): unknown { this.depth++; this.seen.push(values.join()); try { return callee.apply(self, values); } finally { this.depth--; } }
  wrap(callee: Function) { const scope = this; return function (this: unknown, ...values: unknown[]) { return scope.enter(callee, this, ...values); }; }
}
class Louder { seen: string[] = []; enter(callee: Function, self: unknown, ...values: unknown[]): unknown { this.seen.push(values.join()); return "loud:" + callee.apply(self, values); } }
const add = function (this: unknown, ...values: number[]) { return (this === undefined ? "none" : typeof this) + ":" + values.reduce((sum, value) => sum + value, 0); };
const wrap = Reflect.get(Scope.prototype, ["wr", "ap"].join("")) as Function;
const receivers: unknown[] = [new Scope(), new Louder(), { enter(callee: Function, self: unknown, ...values: unknown[]) { return "other:" + values.length; } }, Object.create(new Scope()), 5, "text"];
const said: string[] = [];
for (let turn = 0; turn < 300; turn++) {
  for (const receiver of receivers) {
    let answer: unknown;
    try {
      const wrapped = Reflect.apply(wrap, receiver, [add]) as Function;
      answer = [wrapped(), wrapped(turn), wrapped(1, 2, 3), wrapped.call({ tag: 1 }, 4, 5), wrapped(...new Array(3)), wrapped(...Array.from({ length: 40 }, (unused, index) => index))].join(" ");
    } catch (error) { answer = (error as Error).constructor.name; }
    if (turn % 100 === 0) said.push(String(answer));
  }
}
console.log(said.join("\n"));
console.log((receivers[0] as Scope).depth, (receivers[0] as Scope).seen.length, (receivers[1] as Louder).seen.length);
