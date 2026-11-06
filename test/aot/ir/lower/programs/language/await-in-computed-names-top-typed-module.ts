// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: Named await show arrow
// CHECK-LABEL: function {{*}}name="Named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="await"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=4
// CHECK-NEXT: v1 = Convert v0 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Builtin builtin=JSON
// CHECK-NEXT: v7 = PropGet v6 key="stringify"
// CHECK-NEXT: v8 = Convert v7 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v8, v6, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Call v5, v3, v10 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="await"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Convert v1 declared={type=number|object site=[[w_8]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="arrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] syntax=[HasWrittenAwait] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|object> flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewDictionary
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="name"
// CHECK-NEXT: v3 = String string="arrow"
// CHECK-NEXT: v4 = Call v2, -, v3 calleeName="name"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = Await v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v8 = ToPropertyKey v7
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Convert v9 declared={type=number site=[[w_12]]}
// CHECK-NEXT: ElemDefine v0, v8, v10
// CHECK-NEXT: v12 = Convert v0 declared={type=undefined|null|object site=[[w_13]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
