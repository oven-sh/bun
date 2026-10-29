// RUN: lower
// OPTIONS: builtin-modules

// `bun run` evaluates a class statement at the top level of a file before the file's other statements when its evaluation runs no code of the program. Which classes those are.
function attempt(read) {
  try {
    return typeof read();
  } catch (error) {
    return error.name;
  }
}
function effect() {
  return 1;
}
const later = 1;
const readers = {
  Empty: () => Empty,
  Methods: () => Methods,
  InstanceFields: () => InstanceFields,
  PrivateMembers: () => PrivateMembers,
  StaticWithoutValue: () => StaticWithoutValue,
  StaticNumber: () => StaticNumber,
  StaticNegativeNumber: () => StaticNegativeNumber,
  StaticString: () => StaticString,
  StaticTemplate: () => StaticTemplate,
  StaticTemplateWithValue: () => StaticTemplateWithValue,
  StaticTaggedTemplate: () => StaticTaggedTemplate,
  StaticNull: () => StaticNull,
  StaticUndefined: () => StaticUndefined,
  StaticVoid: () => StaticVoid,
  StaticBoolean: () => StaticBoolean,
  StaticBigInt: () => StaticBigInt,
  StaticArrow: () => StaticArrow,
  StaticFunction: () => StaticFunction,
  StaticClass: () => StaticClass,
  StaticDerivedClass: () => StaticDerivedClass,
  StaticObject: () => StaticObject,
  StaticArray: () => StaticArray,
  StaticRegExp: () => StaticRegExp,
  StaticCall: () => StaticCall,
  StaticName: () => StaticName,
  StaticSum: () => StaticSum,
  StaticImportMeta: () => StaticImportMeta,
  StaticInParentheses: () => StaticInParentheses,
  StaticPrivateNumber: () => StaticPrivateNumber,
  StaticPrivateCall: () => StaticPrivateCall,
  StaticThis: () => StaticThis,
  StaticBlock: () => StaticBlock,
  Derived: () => Derived,
  DerivedFromNull: () => DerivedFromNull,
  BracketedStringMethod: () => BracketedStringMethod,
  BracketedNumberMethod: () => BracketedNumberMethod,
  BracketedField: () => BracketedField,
  BracketedStaticGetter: () => BracketedStaticGetter,
  StringMethod: () => StringMethod,
  NumberMethod: () => NumberMethod,
  Generators: () => Generators,
  Exported: () => Exported,
  ExportedWithCall: () => ExportedWithCall,
  DefaultExport: () => DefaultExport,
  AfterOthers: () => AfterOthers,
};
for (const name in readers) console.log("early", name, attempt(readers[name]));
console.log(new InstanceFields().b, Methods.s(), StaticArrow.f(), new AfterOthers().other() === Empty);

class Empty {}
class Methods { m() {} get g() { return 1; } set g(v) {} static s() { return later; } static get sg() { return 1; } static set sg(v) {} constructor() { effect(); } }
class InstanceFields { a = 1; b = effect(); c = [later]; }
class PrivateMembers { #p = effect(); #m() {} get #g() { return 1; } static #sm() {} static has(o) { return #p in o; } }
class StaticWithoutValue { static u; }
class StaticNumber { static n = 1; }
class StaticNegativeNumber { static n = -1; }
class StaticString { static s = "s"; }
class StaticTemplate { static t = `t`; }
class StaticTemplateWithValue { static t = `t${1}`; }
class StaticTaggedTemplate { static t = String.raw`t`; }
class StaticNull { static n = null; }
class StaticUndefined { static u = undefined; }
class StaticVoid { static u = void 0; }
class StaticBoolean { static t = true; static f = false; }
class StaticBigInt { static n = 1n; }
class StaticArrow { static f = () => later; }
class StaticFunction { static f = function () { return later; }; static g = async function* () {}; }
class StaticClass { static c = class {}; }
class StaticDerivedClass { static c = class extends Object {}; }
class StaticObject { static o = {}; }
class StaticArray { static a = []; }
class StaticRegExp { static r = /r/; }
class StaticCall { static n = effect(); }
class StaticName { static n = effect; }
class StaticSum { static n = 1 + 1; }
class StaticImportMeta { static m = import.meta; }
class StaticInParentheses { static n = (1); }
class StaticPrivateNumber { static #n = 1; }
class StaticPrivateCall { static #n = effect(); }
class StaticThis { static n = this; }
class StaticBlock { static {} }
class Derived extends Empty {}
class DerivedFromNull extends null {}
class BracketedStringMethod { ["m"]() {} }
class BracketedNumberMethod { [0]() {} }
class BracketedField { ["f"] = 1; }
class BracketedStaticGetter { static get ["g"]() { return 1; } }
class StringMethod { "m"() {} "a b" = 1; }
class NumberMethod { 0() {} 1.5 = 1; }
class Generators { *g() {} async a() {} async *ag() {} static *sg() {} static async sa() {} }
export class Exported {}
export class ExportedWithCall { static n = effect(); }
export default class DefaultExport {}
class AfterOthers { other() { return Empty; } }

for (const name in readers) console.log("late", name, attempt(readers[name]));

{
  console.log("in a block", attempt(() => InBlock));
  class InBlock {}
}
function inFunction() {
  const early = attempt(() => InFunction);
  class InFunction {}
  return early;
}
console.log("in a function", inFunction());
if (later) {
  console.log("in an if", attempt(() => InIf));
  class InIf {}
}
label: {
  console.log("under a label", attempt(() => UnderLabel));
  class UnderLabel {}
}

// GENERATED: attempt inFunction sg has ag c
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Call v0 calleeName="read"
// CHECK-NEXT: v2 = TypeOf v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v3 = CatchValue
// CHECK-NEXT: v4 = PropGet v3 key="name"
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inFunction"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewObject layout=[[L_1]]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="attempt"
// CHECK-NEXT: v4 = NewClosure function=[[f_4]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_5]]
// CHECK-NEXT: v6 = FinishClass v5 layout=[[L_5]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Convert v6 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutEnvironmentField v0, v8 layout=[[L_1]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sg"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasExplicitName] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sg"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Undefined
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object flags=[IsExpected]}] results=[{type=boolean flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_7]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="ag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsAsync, IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=[[L_8]] flags=[IsExpected]} results=[{type=undefined|null|AsyncGenerator<never> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_8]], v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sg"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] thisType={type=function flags=[IsExpected]} results=[{type=undefined|null|Generator<never> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: function, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_10]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="c"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_12]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_12]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
