// Fields are assigned ("useDefineForClassFields": false) unless one stands under a key that the transpiler has to compute. A list, an object, a function, a pattern, `typeof` or `void` picks the key,
// and nobody takes its value: `bun build` writes nothing for it where it does nothing, and has the string or the number alone in the brackets. Where it may do something the key stays computed.
// Reference: bun build --compile
// @ts-nocheck
import { sep as imported } from "node:path";
const KEY = "text";
let calls = 0;
globalThis.someGlobal2 = 5;
function call() { calls++; return 1; }
let local = 1;
local = 2;
const list = [1], holder = { x: 1 };
const hits = [];
class Above {}
Object.setPrototypeOf(Above.prototype, new Proxy({}, {
  set(target, key) {
    hits.push(String(key));
    return true;
  },
}));
const found = [];
function show(name, made) {
  found.push(name + "=" + (hits.length ? "assigned" : "defined") + ":" + (hits.pop() ?? Object.keys(made)[0]) + (calls ? " calls " + calls : ""));
  calls = 0;
}
class C_emptyList extends Above { [[] ? "a" : "b"] = 1; }
show("emptyList", new C_emptyList());
class C_listOfNumber extends Above { [[1] ? "a" : "b"] = 1; }
show("listOfNumber", new C_listOfNumber());
class C_listOfLocal extends Above { [[local] ? "a" : "b"] = 1; }
show("listOfLocal", new C_listOfLocal());
class C_listOfConstant extends Above { [[KEY] ? "a" : "b"] = 1; }
show("listOfConstant", new C_listOfConstant());
class C_listOfGlobal extends Above { [[someGlobal2] ? "a" : "b"] = 1; }
show("listOfGlobal", new C_listOfGlobal());
class C_listOfCall extends Above { [[call()] ? "a" : "b"] = 1; }
show("listOfCall", new C_listOfCall());
class C_listOfSpread extends Above { [[...[]] ? "a" : "b"] = 1; }
show("listOfSpread", new C_listOfSpread());
class C_listOfSpreadList extends Above { [[...[1]] ? "a" : "b"] = 1; }
show("listOfSpreadList", new C_listOfSpreadList());
class C_listOfSpreadLocal extends Above { [[...list] ? "a" : "b"] = 1; }
show("listOfSpreadLocal", new C_listOfSpreadLocal());
class C_listOfList extends Above { [[[], {}] ? "a" : "b"] = 1; }
show("listOfList", new C_listOfList());
class C_listWithHole extends Above { [[,] ? "a" : "b"] = 1; }
show("listWithHole", new C_listWithHole());
class C_emptyObject extends Above { [({}) ? "a" : "b"] = 1; }
show("emptyObject", new C_emptyObject());
class C_objectOfNumber extends Above { [({ a: 1 }) ? "a" : "b"] = 1; }
show("objectOfNumber", new C_objectOfNumber());
class C_objectOfCall extends Above { [({ a: call() }) ? "a" : "b"] = 1; }
show("objectOfCall", new C_objectOfCall());
class C_objectComputed extends Above { [({ [KEY]: 1 }) ? "a" : "b"] = 1; }
show("objectComputed", new C_objectComputed());
class C_objectComputedText extends Above { [({ ["k"]: 1 }) ? "a" : "b"] = 1; }
show("objectComputedText", new C_objectComputedText());
class C_objectSpread extends Above { [({ ...holder }) ? "a" : "b"] = 1; }
show("objectSpread", new C_objectSpread());
class C_objectMethod extends Above { [({ m() {} }) ? "a" : "b"] = 1; }
show("objectMethod", new C_objectMethod());
class C_objectGetter extends Above { [({ get g() { return 1; } }) ? "a" : "b"] = 1; }
show("objectGetter", new C_objectGetter());
class C_objectShorthand extends Above { [({ local }) ? "a" : "b"] = 1; }
show("objectShorthand", new C_objectShorthand());
class C_objectProto extends Above { [({ __proto__: null }) ? "a" : "b"] = 1; }
show("objectProto", new C_objectProto());
class C_arrow extends Above { [(() => 1) ? "a" : "b"] = 1; }
show("arrow", new C_arrow());
class C_functionTest extends Above { [(function () {}) ? "a" : "b"] = 1; }
show("functionTest", new C_functionTest());
class C_asyncArrow extends Above { [(async () => 1) ? "a" : "b"] = 1; }
show("asyncArrow", new C_asyncArrow());
class C_generatorTest extends Above { [(function* () {}) ? "a" : "b"] = 1; }
show("generatorTest", new C_generatorTest());
class C_classTest extends Above { [(class {}) ? "a" : "b"] = 1; }
show("classTest", new C_classTest());
class C_classWithStatic extends Above { [(class { static s = call(); }) ? "a" : "b"] = 1; }
show("classWithStatic", new C_classWithStatic());
class C_classWithField extends Above { [(class { f = 1; }) ? "a" : "b"] = 1; }
show("classWithField", new C_classWithField());
class C_classExtends extends Above { [(class extends Above {}) ? "a" : "b"] = 1; }
show("classExtends", new C_classExtends());
class C_regex extends Above { [/x/ ? "a" : "b"] = 1; }
show("regex", new C_regex());
class C_typeOfUnknown extends Above { [typeof someGlobal ? "a" : "b"] = 1; }
show("typeOfUnknown", new C_typeOfUnknown());
class C_typeOfLocal extends Above { [typeof local ? "a" : "b"] = 1; }
show("typeOfLocal", new C_typeOfLocal());
class C_typeOfCall extends Above { [typeof call() ? "a" : "b"] = 1; }
show("typeOfCall", new C_typeOfCall());
class C_typeOfMember extends Above { [typeof holder.x ? "a" : "b"] = 1; }
show("typeOfMember", new C_typeOfMember());
class C_typeOfList extends Above { [typeof [] ? "a" : "b"] = 1; }
show("typeOfList", new C_typeOfList());
class C_voidCall extends Above { [void call() ? "a" : "b"] = 1; }
show("voidCall", new C_voidCall());
class C_voidLocal extends Above { [void local ? "a" : "b"] = 1; }
show("voidLocal", new C_voidLocal());
class C_voidList extends Above { [void [] ? "a" : "b"] = 1; }
show("voidList", new C_voidList());
class C_notList extends Above { [![] ? "a" : "b"] = 1; }
show("notList", new C_notList());
class C_notObject extends Above { [!{} ? "a" : "b"] = 1; }
show("notObject", new C_notObject());
class C_notArrow extends Above { [!(() => 1) ? "a" : "b"] = 1; }
show("notArrow", new C_notArrow());
class C_notRegex extends Above { [!/x/ ? "a" : "b"] = 1; }
show("notRegex", new C_notRegex());
class C_notTypeOf extends Above { [!typeof someGlobal ? "a" : "b"] = 1; }
show("notTypeOf", new C_notTypeOf());
class C_notNotList extends Above { [!![] ? "a" : "b"] = 1; }
show("notNotList", new C_notNotList());
class C_notListOfCall extends Above { [![call()] ? "a" : "b"] = 1; }
show("notListOfCall", new C_notListOfCall());
class C_listAnd extends Above { [[] && "k"] = 1; }
show("listAnd", new C_listAnd());
class C_objectAnd extends Above { [({}) && "k"] = 1; }
show("objectAnd", new C_objectAnd());
class C_arrowAnd extends Above { [(() => 1) && "k"] = 1; }
show("arrowAnd", new C_arrowAnd());
class C_functionAnd extends Above { [(function () {}) && "k"] = 1; }
show("functionAnd", new C_functionAnd());
class C_regexAnd extends Above { [/x/ && "k"] = 1; }
show("regexAnd", new C_regexAnd());
class C_classAnd extends Above { [(class {}) && "k"] = 1; }
show("classAnd", new C_classAnd());
class C_typeOfAnd extends Above { [typeof someGlobal && "k"] = 1; }
show("typeOfAnd", new C_typeOfAnd());
class C_notListOr extends Above { [![] || "k"] = 1; }
show("notListOr", new C_notListOr());
class C_notArrowOr extends Above { [!(() => 1) || "k"] = 1; }
show("notArrowOr", new C_notArrowOr());
class C_notRegexOr extends Above { [!/x/ || "k"] = 1; }
show("notRegexOr", new C_notRegexOr());
class C_notTypeOfOr extends Above { [!typeof someGlobal || "k"] = 1; }
show("notTypeOfOr", new C_notTypeOfOr());
class C_voidCallOr extends Above { [void call() || "k"] = 1; }
show("voidCallOr", new C_voidCallOr());
class C_voidLocalOr extends Above { [void local || "k"] = 1; }
show("voidLocalOr", new C_voidLocalOr());
class C_voidLocalNullish extends Above { [void local ?? "k"] = 1; }
show("voidLocalNullish", new C_voidLocalNullish());
class C_voidCallNullish extends Above { [void call() ?? "k"] = 1; }
show("voidCallNullish", new C_voidCallNullish());
class C_listOr extends Above { [[] || "k"] = 1; }
show("listOr", new C_listOr());
class C_arrowOr extends Above { [(() => 1) || "k"] = 1; }
show("arrowOr", new C_arrowOr());
class C_listNullish extends Above { [[] ?? "k"] = 1; }
show("listNullish", new C_listNullish());
class C_listComma extends Above { [([], "m")] = 1; }
show("listComma", new C_listComma());
class C_arrowComma extends Above { [(() => 1, "m")] = 1; }
show("arrowComma", new C_arrowComma());
class C_nestedList extends Above { [([] ? 1 : 0) ? "x" : "y"] = 1; }
show("nestedList", new C_nestedList());
class C_nestedArrow extends Above { [((() => 1) ? 1 : 0) ? "x" : "y"] = 1; }
show("nestedArrow", new C_nestedArrow());
class C_listPicksNumber extends Above { [[] ? 7 : 8] = 1; }
show("listPicksNumber", new C_listPicksNumber());
class C_listPicksSum extends Above { [[] ? 1 + 1 : 0] = 1; }
show("listPicksSum", new C_listPicksSum());
class C_listPicksConstant extends Above { [[] ? KEY : "b"] = 1; }
show("listPicksConstant", new C_listPicksConstant());
class C_arrowPicksConstant extends Above { [(() => 1) ? KEY : "b"] = 1; }
show("arrowPicksConstant", new C_arrowPicksConstant());
class C_commaOfListTest extends Above { [([], 1) ? "a" : "b"] = 1; }
show("commaOfListTest", new C_commaOfListTest());
class C_commaOfCallTest extends Above { [(call(), 1) ? "a" : "b"] = 1; }
show("commaOfCallTest", new C_commaOfCallTest());
class C_orOfLists extends Above { [([] || 0) ? "a" : "b"] = 1; }
show("orOfLists", new C_orOfLists());
class C_andOfLists extends Above { [([] && 0) ? "a" : "b"] = 1; }
show("andOfLists", new C_andOfLists());
class C_unknownOrList extends Above { [(local || []) ? "a" : "b"] = 1; }
show("unknownOrList", new C_unknownOrList());
class C_unknownAndVoid extends Above { [(local && void 0) ? "a" : "b"] = 1; }
show("unknownAndVoid", new C_unknownAndVoid());
class C_callOrList extends Above { [(call() || []) ? "a" : "b"] = 1; }
show("callOrList", new C_callOrList());
class C_assertedList extends Above { [([] as unknown) ? "a" : "b"] = 1; }
show("assertedList", new C_assertedList());
class C_newTest extends Above { [new Above() ? "a" : "b"] = 1; }
show("newTest", new C_newTest());
class C_templateOfLocal extends Above { [`t${local}` ? "a" : "b"] = 1; }
show("templateOfLocal", new C_templateOfLocal());
class C_importMeta extends Above { [import.meta ? "a" : "b"] = 1; }
show("importMeta", new C_importMeta());
class C_thisTest extends Above { [typeof this ? "a" : "b"] = 1; }
show("thisTest", new C_thisTest());
class C_typeOfLength extends Above { [typeof "abc".length ? "a" : "b"] = 1; }
show("typeOfLength", new C_typeOfLength());
class C_typeOfConstant extends Above { [typeof KEY ? "a" : "b"] = 1; }
show("typeOfConstant", new C_typeOfConstant());
class C_voidConstant extends Above { [void KEY ? "a" : "b"] = 1; }
show("voidConstant", new C_voidConstant());
class C_objectOfConstant extends Above { [({ a: KEY }) ? "a" : "b"] = 1; }
show("objectOfConstant", new C_objectOfConstant());
class C_typeOfProcess extends Above { [typeof process ? "a" : "b"] = 1; }
show("typeOfProcess", new C_typeOfProcess());
class C_typeOfUndefined extends Above { [typeof undefined ? "a" : "b"] = 1; }
show("typeOfUndefined", new C_typeOfUndefined());
class C_listOfUndefined extends Above { [[undefined, NaN, Infinity] ? "a" : "b"] = 1; }
show("listOfUndefined", new C_listOfUndefined());
class C_listAndText extends Above { [([] && "k") ? "a" : "b"] = 1; }
show("listAndText", new C_listAndText());
class C_listAndZeroOr extends Above { [([] && 0) || "k"] = 1; }
show("listAndZeroOr", new C_listAndZeroOr());
class C_condOfCallTest extends Above { [((call(), 1) ? "x" : "y") ? "a" : "b"] = 1; }
show("condOfCallTest", new C_condOfCallTest());
class C_condOfListAnd extends Above { [([] ? 1 : 0) && "k"] = 1; }
show("condOfListAnd", new C_condOfListAnd());
class C_notOfComma extends Above { [!([], 0) && "k"] = 1; }
show("notOfComma", new C_notOfComma());
class C_typeOfImport extends Above { [typeof imported ? "a" : "b"] = 1; }
show("typeOfImport", new C_typeOfImport());
class C_listOfImport extends Above { [[imported] ? "a" : "b"] = 1; }
show("listOfImport", new C_listOfImport());
class C_typeOfFunctionName extends Above { [typeof call ? "a" : "b"] = 1; }
show("typeOfFunctionName", new C_typeOfFunctionName());
class C_listOfFunctionName extends Above { [[call] ? "a" : "b"] = 1; }
show("listOfFunctionName", new C_listOfFunctionName());
class C_listOfClassName extends Above { [[Above] ? "a" : "b"] = 1; }
show("listOfClassName", new C_listOfClassName());
class C_listOfThis extends Above { [[this] ? "a" : "b"] = 1; }
show("listOfThis", new C_listOfThis());
class C_listOfPureCall extends Above { [[/* @__PURE__ */ call()] ? "a" : "b"] = 1; }
show("listOfPureCall", new C_listOfPureCall());
class C_listOfTemplate extends Above { [[`t${local}`] ? "a" : "b"] = 1; }
show("listOfTemplate", new C_listOfTemplate());
class C_listOfSum extends Above { [[local + 1] ? "a" : "b"] = 1; }
show("listOfSum", new C_listOfSum());
class C_listOfStrictEqual extends Above { [[local === 1] ? "a" : "b"] = 1; }
show("listOfStrictEqual", new C_listOfStrictEqual());
class C_listOfLess extends Above { [[local < 1] ? "a" : "b"] = 1; }
show("listOfLess", new C_listOfLess());
class C_listOfCond extends Above { [[local ? 1 : 2] ? "a" : "b"] = 1; }
show("listOfCond", new C_listOfCond());
class C_listOfTypeOf extends Above { [[typeof someGlobal] ? "a" : "b"] = 1; }
show("listOfTypeOf", new C_listOfTypeOf());
class C_objectNumericKey extends Above { [({ 1: 1 }) ? "a" : "b"] = 1; }
show("objectNumericKey", new C_objectNumericKey());
class C_objectStringKey extends Above { [({ "k": 1 }) ? "a" : "b"] = 1; }
show("objectStringKey", new C_objectStringKey());
class C_emptyTemplateTest extends Above { [`` ? "a" : "b"] = 1; }
show("emptyTemplateTest", new C_emptyTemplateTest());
class C_listOfAssign extends Above { [[(local = 3)] ? "a" : "b"] = 1; }
show("listOfAssign", new C_listOfAssign());
class C_listOfNew extends Above { [[new Above()] ? "a" : "b"] = 1; }
show("listOfNew", new C_listOfNew());
class C_listOfAwaitless extends Above { [[async function () {}] ? "a" : "b"] = 1; }
show("listOfAwaitless", new C_listOfAwaitless());
class C_listOfClass extends Above { [[class {}] ? "a" : "b"] = 1; }
show("listOfClass", new C_listOfClass());
class C_typeOfClass extends Above { [typeof class {} ? "a" : "b"] = 1; }
show("typeOfClass", new C_typeOfClass());
class C_typeOfArrow extends Above { [typeof (() => 1) ? "a" : "b"] = 1; }
show("typeOfArrow", new C_typeOfArrow());
class C_typeOfArrowKey extends Above { [typeof (() => 1)] = 1; }
show("typeOfArrowKey", new C_typeOfArrowKey());
class C_typeOfListKey extends Above { [typeof []] = 1; }
show("typeOfListKey", new C_typeOfListKey());
class C_typeOfRegexKey extends Above { [typeof /x/] = 1; }
show("typeOfRegexKey", new C_typeOfRegexKey());
class C_typeOfNullKey extends Above { [typeof null] = 1; }
show("typeOfNullKey", new C_typeOfNullKey());
class C_nullishOfList extends Above { [([] ?? 0) ? "a" : "b"] = 1; }
show("nullishOfList", new C_nullishOfList());
class C_optionalOnNull extends Above { [null?.x ? "a" : "b"] = 1; }
show("optionalOnNull", new C_optionalOnNull());
console.log(found.join("\n"));
