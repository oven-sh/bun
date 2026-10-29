// RUN: lower
// OPTIONS: builtin-modules

// FILE: main.ts
// Standard decorators. The decorators are constants; the decorated classes are named nowhere; other classes and constants of the file are named only by a decorator's argument, by a decorated field's initializer, or not at all.
const log: string[] = [];
const register = (value: Function, context: ClassDecoratorContext) => { log.push("registered " + String(context.name)); };
const tagged = (tag: { text: string }) => (value: Function, context: ClassDecoratorContext) => { log.push("tagged " + tag.text); };
const bound = (value: Function, context: ClassMethodDecoratorContext) => { log.push("method " + String(context.name)); };
const watched = (value: undefined, context: ClassFieldDecoratorContext) => (initial: any) => { log.push("field " + String(context.name) + " = " + initial); return initial; };
const argument = { text: "an argument of a decorator" };
const initial = "the initializer of a decorated field";
const unusedDecorator = (value: Function) => {};
const unusedConstant = { a: 1 };
class Plain { name() { return "plain"; } }
class UnusedPlain {}

@register
class First {}

@tagged(argument)
class Second { @bound method() {} }

class Third { @watched field = initial; made = new Plain().name(); }

console.log(new Third().made);
console.log(log.join("\n"));

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: register tagged Second method
// CHECK-LABEL: function {{*}}name="register"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=undefined|null|function site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[L_2]] flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|function, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="log"
// CHECK-NEXT: v4 = PropGet v3 key="push"
// CHECK-NEXT: v5 = String string="registered "
// CHECK-NEXT: v6 = Builtin builtin=String
// CHECK-NEXT: v7 = PropGet v1 key="name"
// CHECK-NEXT: v8 = Call v6, -, v7 calleeName="String"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v10 = Add v5, v9
// CHECK-NEXT: v11 = Call v4, v3, v10 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_6]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tagged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_12]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_9]] site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Second"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_13]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_13]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_13]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_14]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
