// What a stack trace of plain Bun shows for each kind of site: JavaScriptCore reports a divot, and Bun's source map takes it back to the last token that js_printer maps.
// RUN: lower
// CHECK-LABEL: function {{*}}name="asksIn"
// CHECK: = PropHas {{*}} @2290
// CHECK-LABEL: function {{*}}name="asksInstanceOf"
// CHECK: = InstanceOf {{*}} @2369
// CHECK-LABEL: function {{*}}name="awaitsCall"
// CHECK: = Call {{*}} @2435
// CHECK: = Await {{*}} @2435
// CHECK-LABEL: function {{*}}name="awaitsLastBranch"
// CHECK: = Await {{*}} @2544
// CHECK-LABEL: function {{*}}name="awaitsMember"
// CHECK: = Await {{*}} @2615
// CHECK-LABEL: function {{*}}name="awaitsMethod"
// CHECK: = Await {{*}} @2687
// CHECK-LABEL: function {{*}}name="callsFunctionExpression"
// CHECK: = NewClosure
// CHECK: = Call {{*}} @2773
// CHECK-LABEL: function {{*}}name="constructsAndReads"
// CHECK: = Construct {{*}} @2845
// CHECK-LABEL: function {{*}}name="constructsNativeError"
// CHECK: = Construct {{*}} @2910
// CHECK-LABEL: function {{*}}name="constructsWithArguments"
// CHECK: = Construct {{*}} @3000
// CHECK-LABEL: function {{*}}name="constructsWithoutArguments"
// CHECK: = Construct {{*}} @3071
// CHECK-LABEL: function {{*}}name="delegates"
// CHECK: = IteratorOpen {{*}} @3132
// CHECK-LABEL: function {{*}}name="deletes"
// CHECK: = PropDelete {{*}} @3195
// CHECK-LABEL: function {{*}}name="destructures"
// CHECK: = PropGet {{*}}key="x"{{*}} @3258
// CHECK-LABEL: function {{*}}name="enumerates"
// CHECK: = ForInOpen {{*}} @3347
// CHECK-LABEL: function {{*}}name="iterates"
// CHECK: = IteratorOpen {{*}} @3434
// CHECK: = IteratorResume {{*}} @3434
// CHECK-LABEL: function {{*}}name="spreads"
// CHECK: AppendSpread {{*}} @3527
// CHECK-LABEL: function {{*}}name="stores"
// CHECK: PropSet {{*}} @3574
// CHECK-LABEL: function {{*}}name="storesAfterPostfix"
// CHECK: PropSet {{*}} @3637
// CHECK-LABEL: function {{*}}name="storesAfterPrefix"
// CHECK: PropSet {{*}} @3693
// CHECK-LABEL: function {{*}}name="storesCompound"
// CHECK: PropSet {{*}} @3750
// CHECK-LABEL: function {{*}}name="tagsTemplate"
// CHECK: = Call {{*}}calleeName="tag" @3811
// CHECK-LABEL: function {{*}}name="WithInitializer"
// CHECK: = CallDirect {{*}} @3884

export function asksIn(a: any) {
  return "x" in a.b;
}

export function asksInstanceOf(x: any, a: any) {
  return x instanceof a.C;
}

export async function awaitsCall(f: any) {
  return await f();
}

export async function awaitsLastBranch(flag: boolean, f: any, g: any) {
  return await (flag ? f() : g());
}

export async function awaitsMember(a: any) {
  return await a.b.c;
}

export async function awaitsMethod(a: any) {
  return await a.b.c();
}

export function callsFunctionExpression(use: any) {
  (function () {
    use(1);
  })();
}

export function constructsAndReads(C: any) {
  return new C().x;
}

export function constructsNativeError() {
  return new RangeError();
}

export function constructsWithArguments(a: any, x: any) {
  return new a.C(x);
}

export function constructsWithoutArguments(C: any) {
  return new C();
}

export function* delegates(list: any) {
  yield* list;
}

export function deletes(a: any) {
  return delete a.b.c;
}

export function destructures(a: any) {
  const { x } = a.b.c;
  return x;
}

export function enumerates(a: any, use: any) {
  for (const key in a.b.c) use(key);
}

export function iterates(list: any, use: any) {
  for (const [first, second] of list) use(first, second);
}

export function spreads(list: any) {
  return [0, ...list];
}

export function stores(a: any) {
  a.b.c = 1;
}

export function storesAfterPostfix(a: any) {
  a.b.c++;
}

export function storesAfterPrefix(a: any) {
  ++a.b.c;
}

export function storesCompound(a: any) {
  a.b.c += 1;
}

export function tagsTemplate(a: any) {
  return a.tag`text`;
}

export class WithInitializer {
  field = [1];
  constructor(use: any) {
    use(this);
  }
}
