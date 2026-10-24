// What a stack trace of plain Bun shows for each kind of site: JavaScriptCore reports a divot, and Bun's source map takes it back to the last token that js_printer maps.
// RUN: lower
// CHECK-LABEL: function {{*}}name="asksIn"
// CHECK: = PropHas {{*}} @2292
// CHECK-LABEL: function {{*}}name="asksInstanceOf"
// CHECK: = InstanceOf {{*}} @2371
// CHECK-LABEL: function {{*}}name="awaitsCall"
// CHECK: = Call {{*}} @2437
// CHECK: = Await {{*}} @2437
// CHECK-LABEL: function {{*}}name="awaitsLastBranch"
// CHECK: = Await {{*}} @2546
// CHECK-LABEL: function {{*}}name="awaitsMember"
// CHECK: = Await {{*}} @2617
// CHECK-LABEL: function {{*}}name="awaitsMethod"
// CHECK: = Await {{*}} @2689
// CHECK-LABEL: function {{*}}name="callsFunctionExpression"
// CHECK: = NewClosure
// CHECK: = Call {{*}} @2775
// CHECK-LABEL: function {{*}}name="constructsAndReads"
// CHECK: = Construct {{*}} @2847
// CHECK-LABEL: function {{*}}name="constructsNativeError"
// CHECK: = Construct {{*}} @2912
// CHECK-LABEL: function {{*}}name="constructsWithArguments"
// CHECK: = Construct {{*}} @3002
// CHECK-LABEL: function {{*}}name="constructsWithoutArguments"
// CHECK: = Construct {{*}} @3073
// CHECK-LABEL: function {{*}}name="delegates"
// CHECK: = IteratorOpen {{*}} @3134
// CHECK-LABEL: function {{*}}name="deletes"
// CHECK: = PropDelete {{*}} @3197
// CHECK-LABEL: function {{*}}name="destructures"
// CHECK: = PropGet {{*}}key="x"{{*}} @3260
// CHECK-LABEL: function {{*}}name="enumerates"
// CHECK: = ForInOpen {{*}} @3349
// CHECK-LABEL: function {{*}}name="iterates"
// CHECK: = IteratorOpen {{*}} @3436
// CHECK: = IteratorResume {{*}} @3436
// CHECK-LABEL: function {{*}}name="spreads"
// CHECK: AppendSpread {{*}} @3529
// CHECK-LABEL: function {{*}}name="stores"
// CHECK: PropSet {{*}} @3576
// CHECK-LABEL: function {{*}}name="storesAfterPostfix"
// CHECK: PropSet {{*}} @3639
// CHECK-LABEL: function {{*}}name="storesAfterPrefix"
// CHECK: PropSet {{*}} @3695
// CHECK-LABEL: function {{*}}name="storesCompound"
// CHECK: PropSet {{*}} @3752
// CHECK-LABEL: function {{*}}name="tagsTemplate"
// CHECK: = Call {{*}}calleeName="a.tag" @3813
// CHECK-LABEL: function {{*}}name="WithInitializer"
// CHECK: = CallDirect {{*}} @3886

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
