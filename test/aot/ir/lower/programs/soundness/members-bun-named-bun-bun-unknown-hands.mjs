// RUN: lower
// OPTIONS: builtin-modules

// Bun goes into hands that nobody follows, its names are listed, and text is evaluated. None of that uses a member of Bun. Each member that the program names on Bun is there, whichever way the program came to Bun.
import defaultExport, { peek as importedPeek } from "bun";
import * as namespace from "bun";
const unknown = value => new CustomEvent("x", { detail: value }).detail;
console.log(Object.keys(unknown(Bun)).length > 50, new Function("return 1")());
const attempt = (way, action) => {
  try {
    console.log(way + ":", action());
  } catch (error) {
    console.log(way + ": threw", error.message);
  }
};
const local = Bun;
const dynamic = await import("bun");
const awaited = await Promise.resolve(Bun);
const through = bun => bun.stringWidth("abc");
class Holder {
  static held = Bun;
  field = Bun;
}
attempt("the global", () => Bun.escapeHTML("<a>"));
attempt("globalThis", () => globalThis.Bun.stripANSI("\x1b[1mb\x1b[0m"));
attempt("a pattern", () => {
  const { deepEquals } = Bun;
  return deepEquals({ a: 1 }, { a: 1 });
});
attempt("a named import", () => importedPeek(1));
attempt("the namespace", () => namespace.indexOfLine(new Uint8Array([97, 10, 98]), 0));
attempt("the default export", () => defaultExport.fileURLToPath("file:///a/b"));
attempt("a constant", () => local.pathToFileURL("/a/b").href);
attempt("a parameter", () => through(Bun));
attempt("an element", () => [Bun][0].concatArrayBuffers([new Uint8Array([1]).buffer]).byteLength);
attempt("a property", () => ({ bun: Bun }).bun.hash.crc32("a"));
attempt("a result", () => (() => Bun)().inspect({ a: 1 }));
attempt("a static field", () => Holder.held.semver.order("1.0.0", "2.0.0"));
attempt("a field", () => new Holder().field.isMainThread);
attempt("a string in brackets", () => Bun["sleepSync"](0));
attempt("an optional chain", () => Bun?.nanoseconds() > 0);
attempt("require", () => import.meta.require("bun").deepMatch({ a: 1 }, { a: 1, b: 2 }));
attempt("a dynamic import", () => typeof dynamic.readableStreamToText);
attempt("a promise", () => typeof awaited.allocUnsafe(1).length);

// GENERATED: unknown attempt through Holder
// CHECK-LABEL: function {{*}}name="unknown"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="CustomEvent" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(CustomEvent) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="x"
// CHECK-NEXT: v5 = NewObject -, v0 layout=[[L_2]] fields=[3]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Construct v3, -, v4, v6 calleeName="CustomEvent"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[L_3]]|Event flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="detail"
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=":"
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = Call v1 calleeName="action"
// CHECK-NEXT: v10 = Call v6, v4, v8, v9 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v11 = CatchValue
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string=": threw"
// CHECK-NEXT: v18 = Add v0, v17
// CHECK-NEXT: v19 = PropGet v11 key="message"
// CHECK-NEXT: v20 = Call v16, v14, v18, v19 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v21 = Undefined
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="through"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="stringWidth"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="abc"
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="stringWidth" calleeName="bun.stringWidth"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
