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
