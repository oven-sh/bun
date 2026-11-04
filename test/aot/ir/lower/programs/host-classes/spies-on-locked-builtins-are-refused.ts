// RUN: lower
// OPTIONS: builtin-modules

// In a compiled executable `spyOn` refuses a fixed member of a built-in. Compiled code calls such a member without looking it up, so a spy on it would never be called. Math.floor is fixed like the members of the prototypes.
import { spyOn } from "bun:test";

const joined = (list: number[]) => list.join("-");
const page = (text: string) => new URL(text).searchParams.get("page");
const header = (headers: Headers) => headers.get("a");
const floored = (value: number) => Math.floor(value);
const own = { method: (): string => "real" };
const input = "http://127.0.0.1:3000/users/7?page=2";

function attempt(label: string, lay: () => { mock: { calls: unknown[] }; mockRestore(): void }, call: () => unknown) {
  const before = call();
  try {
    const spy = lay();
    console.log(label + ": " + before + ", spied: " + call() + ", calls " + spy.mock.calls.length);
    spy.mockRestore();
  } catch (error) {
    console.log(label + ": " + before + ", throws " + (error as Error).name);
  }
  console.log(label + " afterwards: " + call());
}

attempt("Array.prototype.join", () => spyOn(Array.prototype, "join").mockReturnValue("spied"), () => joined([1, 2]));
attempt("Math.floor", () => spyOn(Math, "floor").mockReturnValue(-7), () => floored(1.5));
attempt("URLSearchParams.prototype.get", () => spyOn(URLSearchParams.prototype, "get").mockReturnValue("spied"), () => page(input));
attempt("Headers.prototype.get", () => spyOn(Headers.prototype, "get").mockReturnValue("spied"), () => header(new Headers({ a: "1" })));
attempt("Response.prototype.clone", () => spyOn(Response.prototype, "clone").mockReturnValue(new Response("spied")), () => typeof new Response("x").clone());

const names = process.argv.length > 99 ? ["x"] : ["join"];
attempt("a name that is not known at build time", () => spyOn(Array.prototype as unknown as Record<string, () => string>, names[0]).mockReturnValue("spied"), () => joined([3, 4]));

attempt("an object of the program", () => spyOn(own, "method").mockReturnValue("spied"), () => own.method());

// GENERATED: joined page header floored method
// CHECK-LABEL: function {{*}}name="joined"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="join"
// CHECK-NEXT: v2 = String string="-"
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="join" calleeName="list.join"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="page"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_6]] flags=[OmitsUndefined]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="URL" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(URL) flags=[IsExpected]}
// CHECK-NEXT: v4 = Construct v3, -, v0 calleeName="URL"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|URL flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = PropGet v5 key="searchParams"
// CHECK-NEXT: v7 = PropGet v6 key="get"
// CHECK-NEXT: v8 = String string="page"
// CHECK-NEXT: v9 = Call v7, v6, v8 calleeKey="get" calleeName="get"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string site=[[w_8]] flags=[OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_6]] flags=[OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="header"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|Headers flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|Headers):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="get"
// CHECK-NEXT: v2 = String string="a"
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="get" calleeName="headers.get"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_11]] flags=[OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_9]] flags=[OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="floored"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number site=[[w_12]]}] results=[{type=number site=[[w_13]]}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathFloor
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Math.floor"
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=number site=[[w_15]]}}, {declared={type=number site=[[w_13]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_17]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="real"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
