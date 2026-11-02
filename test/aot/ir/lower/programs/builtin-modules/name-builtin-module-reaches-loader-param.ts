// RUN: lower
// OPTIONS: builtin-modules

// The name of a built-in module is written as a constant, and reaches the call that loads it through a parameter, a loop or a choice.
import { createRequire } from "node:module";

const throughAnArrow = (name: string): any => import.meta.require(name);
console.log("an arrow", typeof throughAnArrow("fs").readFileSync);

function throughAFunction(name: string): any {
  return import.meta.require(name);
}
console.log("a function", typeof throughAFunction("node:path").join);

const twoNames = (name: string): any => import.meta.require(name);
console.log("two names", typeof twoNames("fs").readFileSync, typeof twoNames("node:path").join);

const inALoop = (name: string): any => import.meta.require(name);
for (const name of ["fs", "node:path", "node:os"]) console.log("a loop", name, typeof inALoop(name));

for (const name of ["node:util", "node:url"]) console.log("without a function", name, typeof import.meta.require(name));

const made = createRequire(import.meta.url);
const throughOneThatWasMade = (name: string): any => made(name);
for (const name of ["fs", "node:events"])
  console.log("a require that was made", name, typeof throughOneThatWasMade(name));

const imported = (name: string): Promise<any> => import(name);
for (const name of ["fs", "node:path"]) console.log("imported", name, typeof (await imported(name)).default);

const isFirst = process.argv.length < 100;
console.log("a choice", typeof import.meta.require(isFirst ? "node:vm" : "node:v8").runInNewContext);

// GENERATED: throughAFunction throughAnArrow throughOneThatWasMade imported
// CHECK-LABEL: function {{*}}name="throughAFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["node:path"] -> case b2(), otherwise b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v1 = RequireModule module=[[m_2]] referrer=[[m_0]] specifier="node:path"
// CHECK-NEXT: Jump -> next b4(v1)
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = RequireDynamic v0 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b4(v2)
// CHECK-NEXT: b4(v3):
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="throughAnArrow"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["fs"] -> case b2(), otherwise b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v1 = RequireModule module=[[m_5]] referrer=[[m_0]] specifier="fs"
// CHECK-NEXT: Jump -> next b4(v1)
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = RequireDynamic v0 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b4(v2)
// CHECK-NEXT: b4(v3):
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="throughOneThatWasMade"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="made"
// CHECK-NEXT: SwitchString v0 strings=["fs", "node:events"] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: v3 = RequireModule module=[[m_5]] referrer=[[m_0]] specifier="fs"
// CHECK-NEXT: Jump -> next b5(v3)
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = RequireModule module=[[m_9]] referrer=[[m_0]] specifier="node:events"
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b4():
// CHECK-NEXT: v5 = RequireDynamic v0 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b5(v6):
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="imported"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: SwitchString v0 strings=["fs", "node:path"] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: v1 = ImportModule module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b5(v1)
// CHECK-NEXT: b3():
// CHECK-NEXT: v2 = ImportModule module=[[m_2]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b5(v2)
// CHECK-NEXT: b4():
// CHECK-NEXT: v3 = ImportDynamic v0 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b5(v3)
// CHECK-NEXT: b5(v4):
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Promise flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
