// `await` followed by `(`, `[`, a template, a sign or a regular expression is the operator in a computed name at the top level of a module.
const name = async (text: string) => text;
const show = (value: object) => console.log(JSON.stringify(value));

show({ [await (name)("first")]: 1, [(await (async () => "second")())]: 2 });
show({ [`k${await (name)("template")}`]: 1 });
show({ outer: { [await (name)("inner")]: { [await [name("element")][0]]: 1 } } });
show({ [await `text`]: 1, [await -1]: 2, [await +2]: 3, [await /source/.source]: 4 });
show([{ [await (name)("in a list")]: 1 }]);

const members = {
  [await (name)("method")]() {},
  get [await (name)("getter")]() {
    return 1;
  },
  set [await (name)("setter")](value: number) {},
  async [await (name)("asyncMethod")]() {},
  *[await (name)("generator")]() {},
};
console.log(Object.keys(members).join());

class Declared {
  [await (name)("method")]() {}
  static [await (name)("staticMethod")]() {}
  static get [await (name)("getter")]() {
    return 1;
  }
  set [await (name)("setter")](value: number) {}
}
console.log(Object.getOwnPropertyNames(Declared).join(), Object.getOwnPropertyNames(Declared.prototype).join());

const Expression = class {
  [await (name)("method")]() {}
};
console.log(Object.getOwnPropertyNames(Expression.prototype).join());

const source: Record<string, number> = { a: 1, b: 2 };
const { [await (name)("a")]: bound, [(await (name)("missing"))]: absent = 5 } = source;
let assigned = 0;
({ [await (name)("b")]: assigned } = source);
console.log(bound, absent, assigned);

for (const value of [{ [await (name)("of")]: 1 }]) show(value);
for (const key in { [await (name)("in")]: 1 }) console.log(key);
for (let value = { [await (name)("for")]: 1 }, index = 0; index < 1; index++) show(value);

try {
  show({ [await (name)("try")]: 1 });
  throw 1;
} catch {
  show({ [await (name)("catch")]: 1 });
} finally {
  show({ [await (name)("finally")]: 1 });
}
if (source.a) {
  show({ [await (name)("if")]: 1 });
}
switch (source.a) {
  case 1:
    show({ [await (name)("case")]: 1 });
}
block: {
  show({ [await (name)("block")]: 1 });
}

export const exported = { [await (name)("exported")]: 1 };
export class Exported {
  [await (name)("member")]() {}
}
export default { [await (name)("default")]: 1 };
show(exported);
console.log(Object.getOwnPropertyNames(Exported.prototype).join());

const named = { await: 1, inner: { async await() { return 2; } } };
class Named {
  await = 3;
  static await() {
    return 4;
  }
}
console.log(named.await, await named.inner.await(), new Named().await, Named.await());

async function declared() {
  return { [await (name)("function")]: 1 };
}
const arrow = async () => ({ [await (name)("arrow")]: 1 });
show(await declared());
show(await arrow());
