// Each of these initializers runs code of the program: a function, a getter, a setter, a callback, a conversion, an iterator, a trap. So each runs where its constant is declared, in the order of the declarations, before anything that follows them.
const log: string[] = [];
function tell<V>(name: string, value: V): V { log.push(name); return value; }
function tellNumber(x: number): number { return tell("aNamedCallback", x); }
const KEY = "k";
const WITH_GETTER = { get a(): number { return tell("aGetterOfAConstant", 1); } };
const TOOLS = { make(name: string): { a: number } { return tell(name, { a: 1 }); } };
function takeA({ a }: { a: number }): { v: number } { return { v: a }; }
function copy<V extends object>(it: V): V { return { ...it }; }
function storeA(it: { a: number }): { a: number } { it.a = 1; return it; }
function each(list: number[], visit: (x: number) => void): number[] { list.forEach(visit); return list; }
function loop(list: number[], name: string): number[] { const out: number[] = []; for (const x of list) out.push(tell(name, x)); return out; }
class Telling { constructor(name: string) { tell(name, 0); } }
class TellingField { a = tell("aFieldInitializer", 1); }
class TellingHeir extends Telling { b = 1; }
function withDefault(a: number = tell("aDefaultOfAParameter", 1)): { a: number } { return { a }; }
function withPatternDefault({ a = tell("aDefaultOfAPattern", 1) }: { a?: number }): { a: number } { return { a }; }
function firstOf(from: Iterable<number>): number[] { const [first] = from; return [first ?? 0]; }
function tag(strings: TemplateStringsArray): { a: string } { return tell(strings[0]!, { a: strings[0]! }); }

const aFunctionThatLogs = tell("aFunctionThatLogs", { a: 1 });
const aValueInALiteral = { a: tell("aValueInALiteral", 1) };
const anElementOfAList = [tell("anElementOfAList", 1)];
const aValueUnderAComputedKey = { [KEY]: tell("aValueUnderAComputedKey", 1) };
const aComputedKey = { [tell("aComputedKey", "k")]: 1 };
const aKeyWithToString = { [{ toString(): string { return tell("aKeyWithToString", "k"); } } as any]: 1 };
const aGetterRunByASpread = { ...{ get a(): number { return tell("aGetterRunByASpread", 1); } } };
const aGetterRunByAssign = Object.assign({}, { get a(): number { return tell("aGetterRunByAssign", 1); } });
const aGetterRunByValues = Object.values({ get a(): number { return tell("aGetterRunByValues", 1); } });
const aGetterRunByEntries = Object.entries({ get a(): number { return tell("aGetterRunByEntries", 1); } });
const aGetterRunByARead = { v: { get a(): number { return tell("aGetterRunByARead", 1); } }.a };
const aGetterRunByAPattern = takeA({ get a(): number { return tell("aGetterRunByAPattern", 1); } });
const aGetterRunInAHelper = copy({ get a(): number { return tell("aGetterRunInAHelper", 1); } });
const aGetterMovedAndThenSpread = { ...Object.defineProperties({}, Object.getOwnPropertyDescriptors({ get a(): number { return tell("aGetterMovedAndThenSpread", 1); } })) };
const aGetterOfAConstant = { v: WITH_GETTER.a };
const aSetterRunByAssign = Object.assign({ set a(v: number) { tell("aSetterRunByAssign", v); } }, { a: 1 });
const aSetterRunByAStore = storeA({ set a(v: number) { tell("aSetterRunByAStore", v); } });
const aCallbackOfMap = [1].map(x => tell("aCallbackOfMap", x));
const aCallbackOfFilter = [1].filter(x => tell("aCallbackOfFilter", x) > 0);
const aCallbackOfFlatMap = [1].flatMap(x => [tell("aCallbackOfFlatMap", x)]);
const aCallbackOfForEach = each([1], x => { tell("aCallbackOfForEach", x); });
const aCallbackOfSome = { v: [1].some(x => tell("aCallbackOfSome", x) > 0) };
const aCallbackOfFind = { v: [1].find(x => tell("aCallbackOfFind", x) > 0) };
const aCallbackOfSort = [2, 1].sort((x, y) => tell("aCallbackOfSort", x - y));
const aCallbackOfReduce = { v: [1, 2].reduce((x, y) => tell("aCallbackOfReduce", x + y)) };
const aCallbackOfArrayFrom = Array.from([1], x => tell("aCallbackOfArrayFrom", x));
const aNamedCallback = [1].map(tellNumber);
const aLoopBody = loop([1], "aLoopBody");
const aConstructor = new Telling("aConstructor");
const aFieldInitializer = new TellingField();
const aBaseConstructor = new TellingHeir("aBaseConstructor");
const aDefaultOfAParameter = withDefault();
const aDefaultOfAPattern = withPatternDefault({});
const toStringInATemplate = { v: `${{ toString(): string { return tell("toStringInATemplate", "s"); } }}` };
const toStringInAJoin = { v: [{ toString(): string { return tell("toStringInAJoin", "s"); } }].join() };
const valueOfInAConversion = { v: Number({ valueOf(): number { return tell("valueOfInAConversion", 1); } }) };
const toPrimitiveInAConversion = { v: String({ [Symbol.toPrimitive](): string { return tell("toPrimitiveInAConversion", "s"); } }) };
const anIteratorInASpread = [...{ *[Symbol.iterator](): Generator<number> { yield tell("anIteratorInASpread", 1); } }];
const anIteratorInASet = new Set({ *[Symbol.iterator](): Generator<number> { yield tell("anIteratorInASet", 1); } });
const anIteratorInAPattern = firstOf({ *[Symbol.iterator](): Generator<number> { yield tell("anIteratorInAPattern", 1); } });
const aTrapRunByASpread = { ...new Proxy({ a: 1 }, { ownKeys(target) { tell("aTrapRunByASpread", 0); return Reflect.ownKeys(target); } }) };
const aTrapRunByARead = { v: new Proxy({ a: 1 }, { get(target, key) { tell("aTrapRunByARead", 0); return Reflect.get(target, key); } }).a };
const aTrapRunByKeys = Object.keys(new Proxy({ a: 1 }, { ownKeys(target) { tell("aTrapRunByKeys", 0); return Reflect.ownKeys(target); } }));
const aTrapRunByFreeze = Object.freeze(new Proxy({ a: 1 }, { preventExtensions(target) { tell("aTrapRunByFreeze", 0); return Reflect.preventExtensions(target); } }));
const aTaggedTemplate = tag`aTaggedTemplate`;
const aMethodOfAConstant = TOOLS.make("aMethodOfAConstant");
const aFunctionCalledWhereItStands = (() => tell("aFunctionCalledWhereItStands", { a: 1 }))();
const toJSON = { v: JSON.stringify({ toJSON(): number { return tell("toJSON", 1); } }) };
const aReplacerOfReplace = { v: "a".replace("a", () => tell("aReplacerOfReplace", "b")) };
const aStaticBlock = class { static { tell("aStaticBlock", 0); } };
const aStaticField = class { static a = tell("aStaticField", 1); };
const aComputedMemberOfAClass = class { [tell("aComputedMemberOfAClass", "m")](): void {} };
function readAll(): number { return [aFunctionThatLogs, aValueInALiteral, anElementOfAList, aValueUnderAComputedKey, aComputedKey, aKeyWithToString, aGetterRunByASpread, aGetterRunByAssign, aGetterRunByValues, aGetterRunByEntries, aGetterRunByARead, aGetterRunByAPattern, aGetterRunInAHelper, aGetterMovedAndThenSpread, aGetterOfAConstant, aSetterRunByAssign, aSetterRunByAStore, aCallbackOfMap, aCallbackOfFilter, aCallbackOfFlatMap, aCallbackOfForEach, aCallbackOfSome, aCallbackOfFind, aCallbackOfSort, aCallbackOfReduce, aCallbackOfArrayFrom, aNamedCallback, aLoopBody, aConstructor, aFieldInitializer, aBaseConstructor, aDefaultOfAParameter, aDefaultOfAPattern, toStringInATemplate, toStringInAJoin, valueOfInAConversion, toPrimitiveInAConversion, anIteratorInASpread, anIteratorInASet, anIteratorInAPattern, aTrapRunByASpread, aTrapRunByARead, aTrapRunByKeys, aTrapRunByFreeze, aTaggedTemplate, aMethodOfAConstant, aFunctionCalledWhereItStands, toJSON, aReplacerOfReplace, aStaticBlock, aStaticField, aComputedMemberOfAClass].length; }
log.push("loaded");
console.log(String(readAll()));
for (const name of log) console.log(name);
