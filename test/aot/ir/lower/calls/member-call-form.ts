// RUN: lower
// CHECK-LABEL: function {{*}}name="awaited"
// CHECK: b0([[s]]: anything, [[ownS]]: anything,
// CHECK: [[awaitedArea]] = PropGet [[ownS]] key="area"
// CHECK: = Await
// CHECK: = Call [[awaitedArea]], [[ownS]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="bracket"
// CHECK: [[bracketArea]] = PropGet [[s]] key="area"
// CHECK-NEXT: = Call [[bracketArea]], [[s]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="call"
// CHECK: [[callArea]] = PropGet [[s]] key="area"
// CHECK: = Call {{*}}calleeName="f"
// CHECK: = Call [[callArea]], [[s]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="conditional"
// CHECK: [[conditionalArea]] = PropGet [[s]] key="area"
// CHECK: Branch
// CHECK: = Call [[conditionalArea]], [[s]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="construct"
// CHECK: [[constructArea]] = PropGet [[s]] key="area"
// CHECK: = Construct
// CHECK: = Call [[constructArea]], [[s]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="local"
// CHECK: [[localArea]] = PropGet [[s]] key="area"
// CHECK-NEXT: = Call [[localArea]], [[s]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="member"
// CHECK: [[memberArea]] = PropGet [[s]] key="area"
// CHECK: = PropGet {{*}}key="scale"
// CHECK: = Call [[memberArea]], [[s]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: [[sumArea]] = PropGet [[s]] key="area"
// CHECK: = Add
// CHECK: = Call [[sumArea]], [[s]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="template"
// CHECK: [[templateArea]] = PropGet [[s]] key="area"
// CHECK: = Strcat
// CHECK: = Call [[templateArea]], [[s]], {{*}}calleeKey="area" calleeName="s.area"
// CHECK-LABEL: function {{*}}name="Emitter"
// CHECK: [[emit]] = PropGet [[receiver]] key="emit"
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
