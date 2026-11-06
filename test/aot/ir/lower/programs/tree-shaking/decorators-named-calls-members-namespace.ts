// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 2

// FILE: main.ts
// The only references to these functions stand after an @: a plain name, a call, a member of an object, a member of a namespace import, and a parenthesized expression.
import * as marks from "./marks";
import { log } from "./marks";

function plain(value: Function, context: ClassDecoratorContext): void {
  log.push("plain " + String(context.name));
}

function called(text: string) {
  return (value: Function, context: ClassDecoratorContext): void => {
    log.push("called " + text);
  };
}

function pick(): (value: Function, context: ClassDecoratorContext) => void {
  return (value, context) => {
    log.push("picked");
  };
}

@plain
@called("with text")
@marks.imported
@marks.factory("f")
@(pick())
class Target {}

console.log(log.join("\n"));

// FILE: marks.ts
export const log: string[] = [];

export function imported(value: Function, context: ClassDecoratorContext): void {
  log.push("imported");
}

export function factory(text: string) {
  return (value: Function, context: ClassDecoratorContext): void => {
    log.push("factory " + text);
  };
}

export function unused(): void {
  log.push("unused");
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: plain called Target
// CHECK-LABEL: function {{*}}name="plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|function site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_2]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="plain "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = PropGet v1 key="name"
// CHECK-NEXT: v8 = Call v6, -, v7 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Add v5, v9
// CHECK-NEXT: v11 = Call v4, v3, v10 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_5]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="called"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Target"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
