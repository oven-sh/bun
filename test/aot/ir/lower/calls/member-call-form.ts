// RUN: lower
// CHECK-LABEL: function {{*}}name="awaited"
// CHECK: b0([[s]]: anything,
// CHECK: [[awaitedS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[awaitedRead]] = PropGet [[awaitedS]] key="area"
// CHECK-NEXT: [[awaitedArea]] = Convert [[awaitedRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: = Await
// CHECK: = Call [[awaitedArea]], [[awaitedS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="bracket"
// CHECK: [[bracketS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[bracketRead]] = PropGet [[bracketS]] key="area"
// CHECK-NEXT: [[bracketArea]] = Convert [[bracketRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[bracketArea]], [[bracketS]], {{*}}calleeKey="area" calleeName="area"
// CHECK-LABEL: function {{*}}name="call"
// CHECK: [[callS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[callRead]] = PropGet [[callS]] key="area"
// CHECK-NEXT: [[callArea]] = Convert [[callRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: = Call {{*}}calleeName="f"
// CHECK: = Call [[callArea]], [[callS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK: [[conditionalS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[conditionalRead]] = PropGet [[conditionalS]] key="area"
// CHECK-NEXT: [[conditionalArea]] = Convert [[conditionalRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: Branch
// CHECK: = Call [[conditionalArea]], [[conditionalS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: [[constructS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[constructRead]] = PropGet [[constructS]] key="area"
// CHECK-NEXT: [[constructArea]] = Convert [[constructRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: = Construct
// CHECK: = Call [[constructArea]], [[constructS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="local"
// CHECK: [[localS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[localRead]] = PropGet [[localS]] key="area"
// CHECK-NEXT: [[localArea]] = Convert [[localRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: = Call [[localArea]], [[localS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[memberS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[memberRead]] = PropGet [[memberS]] key="area"
// CHECK-NEXT: [[memberArea]] = Convert [[memberRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: = PropGet {{*}}key="scale"
// CHECK: = Call [[memberArea]], [[memberS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: [[sumS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[sumRead]] = PropGet [[sumS]] key="area"
// CHECK-NEXT: [[sumArea]] = Convert [[sumRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: = Add
// CHECK: = Call [[sumArea]], [[sumS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="template"
// CHECK: [[templateS]] = Convert [[s]] declared={type=undefined|null|L{{*}} flags=[IsExpected]}
// CHECK-NEXT: [[templateRead]] = PropGet [[templateS]] key="area"
// CHECK-NEXT: [[templateArea]] = Convert [[templateRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: = Strcat
// CHECK: = Call [[templateArea]], [[templateS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="Emitter"
// CHECK: [[emitRead]] = PropGet [[receiver]] key="emit"
// CHECK-NEXT: [[emit]] = Convert [[emitRead]] declared={type=undefined|null|function flags=[IsExpected]}
// CHECK: = PropGet [[receiver]] key="value"
// CHECK: = Call [[emit]], [[receiver]], {{*}}calleeKey="emit" calleeName="this.emit"

// RUN(NOWHERE): lower
// NOWHERE-NOT: CallMethod

export async function awaited(s: any, p: any) {
  s.area(await p);
}

export function bracket(s: any, k: any) {
  s["area"](k);
}

export function call(s: any, f: any) {
  s.area(f());
}

export function conditional(s: any, c: any, a: any, b: any) {
  s.area(c ? a : b);
}

export function construct(s: any, X: any) {
  s.area(new X());
}

export function local(s: any, k: any) {
  s.area(k);
}

export function member(s: any, cfg: any) {
  s.area(cfg.scale);
}

export function sum(s: any, i: any) {
  s.area(i + 1);
}

export function template(s: any, x: any) {
  s.area(`t${x}`);
}

export class Emitter {
  declare emit: any;
  declare value: any;

  constructor() {
    this.emit("change", this.value);
  }
}
