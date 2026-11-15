// A row of an interface often bears a name more than the interface writes. Names that stand BEHIND all the record's own and that the program's text never spells are laid beside the record, in their order: the row is a
// record all the same, and no read by a written name can ask for them. A strange name in front or in the middle, a name that the text spells somewhere, a name twice: the row is an ordinary object as ever.
// Whatever a program can see of a row is as plain says. The strange names stand in texts alone here and are read by keys that a parse gives.
// COUNTER: ObjectsParsedIntoRecords = 80
// COUNTER: ObjectsParsedIntoOrdinaryObjects = 17
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: what typed code believes of a row that has names beside its record is asked again
interface Row { id: number; name: string; active: boolean }
interface Stamp { stampedAt: number }
const total = (r: Row): number => r.id + r.name.length + (r.active ? 1 : 0);
function tell(label: string, rows: Row[]): void {
  for (const r of rows) {
    const met: string[] = [];
    for (const k in r) met.push(k);
    console.log(label, total(r), Object.keys(r).join(), met.join(), JSON.stringify(r), Object.entries(r).length, Object.keys({ ...r }).join(), Object.getPrototypeOf(r) === Object.prototype, Object.isExtensible(r));
  }
}
const head = JSON.parse('"\\"id\\":1,\\"name\\":\\"ab\\",\\"active\\":true"') as string;
const key = (text: string): string => JSON.parse('"' + text.split("").reverse().join("") + '"');
const CREATED = key("tAdetaerc"), X = key("xx"), Y = key("yy"), Z = key("zz"), W = key("ww");
const rowsOf = (...tails: string[]): Row[] => JSON.parse("[" + tails.map(tail => "{" + tail + "}").join() + "]");
console.log((JSON.parse('[{"stampedAt":3}]') as Stamp[])[0]!.stampedAt);
tell("as written", rowsOf(head, head));
tell("one behind", rowsOf(head + ',"createdAt":5', head + ',"createdAt":6'));
tell("eight behind", rowsOf(head + ',"a":1,"b":"two","c":null,"d":[4],"e":{"f":5},"g":true,"h":1.5,"i":""'));
tell("a row behind", rowsOf(head + ',"inner":{' + head + ',"deep":1}'));
tell("in the middle", rowsOf('"id":1,"createdAt":5,"name":"ab","active":true'));
tell("in front", rowsOf('"createdAt":5,' + head));
tell("another record's", rowsOf(head + ',"stampedAt":5'));
tell("spelled somewhere", rowsOf(head + ',"spelledOnce":5').map(r => (console.log((r as any).spelledOnce), r)));
tell("behind another record's", rowsOf(head + ',"stampedAt":5,"createdAt":6'));
tell("a name twice", rowsOf(head + ',"id":2'));
tell("twice behind a strange one", rowsOf(head + ',"createdAt":5,"id":2'));
tell("a strange one twice", rowsOf(head + ',"createdAt":5,"createdAt":6'));
tell("__proto__", rowsOf(head + ',"__proto__":{"id":9}', head + ',"__proto__":null'));
tell("names of Object.prototype", rowsOf(head + ',"constructor":1,"toString":2,"hasOwnProperty":3,"valueOf":4'));
tell("indexes", rowsOf(head + ',"7":1,"0":2', head + ',"createdAt":5,"3":1'));
tell("the empty name", rowsOf(head + ',"":1'));
tell("a name not in Latin-1", rowsOf(head + ',"世界":1,"café":2'));
tell("a thousand behind", rowsOf(head + Array.from({ length: 1000 }, (_, i) => ',"n' + i + '":' + i).join("")).map(r => { const keys = Object.keys(r); console.log(keys.length, keys[3], keys[1002], (r as any)[key("999n")]); return { id: r.id, name: r.name, active: r.active }; }));
tell("a reviver", JSON.parse("[{" + head + ',"createdAt":5}]', function (name, value) { return name === CREATED ? value + 1 : value; }));
tell("a reviver that drops it", JSON.parse("[{" + head + ',"createdAt":5}]', (name, value) => (name === CREATED ? undefined : value)));

const [row] = rowsOf(head + ',"xx":1,"yy":2'), loose = row as any;
console.log(X in loose, Z in loose, Object.hasOwn(loose, Y), JSON.stringify(Object.getOwnPropertyDescriptor(loose, X)), JSON.stringify(Object.getOwnPropertyDescriptor(loose, "id")), loose[X] + loose[Y]);
loose[X] = "written"; loose[Z] = 3; tell("stored", [row!]);
delete loose.name; console.log(Object.keys(loose).join(), JSON.stringify(loose));
delete loose[X]; console.log(Object.keys(loose).join(), JSON.stringify(loose));
loose.name = "back"; loose[X] = 9; tell("laid again", [row!]);
const [kept] = rowsOf(head + ',"xx":1');
Object.freeze(kept);
console.log(Object.isFrozen(kept), Object.isExtensible(kept), (() => { "use strict"; try { (kept as any)[X] = 2; return "stored"; } catch (e) { return (e as Error).name; } })(), (() => { "use strict"; try { (kept as any)[W] = 2; return "stored"; } catch (e) { return (e as Error).name; } })(), JSON.stringify(kept));
const [sealed] = rowsOf(head + ',"xx":1');
Object.seal(sealed); (sealed as any)[X] = 5; console.log(Object.isSealed(sealed), Reflect.deleteProperty(sealed as object, "id"), Reflect.deleteProperty(sealed as object, X), JSON.stringify(sealed));
const [shut] = rowsOf(head + ',"xx":1');
Object.preventExtensions(shut); console.log(Object.isExtensible(shut), Reflect.set(shut as object, W, 1), Reflect.deleteProperty(shut as object, X), JSON.stringify(shut));
console.log(JSON.stringify(Object.assign({}, rowsOf(head + ',"xx":1')[0])), JSON.stringify(structuredClone(rowsOf(head + ',"xx":1')[0])), JSON.stringify(Object.fromEntries(Object.entries(rowsOf(head + ',"xx":1,"yy":2')[0]!).reverse())));
let sum = 0;
for (const r of rowsOf(...Array.from({ length: 64 }, (_, i) => '"id":' + i + ',"name":"n' + i + '","active":' + (i % 3 === 0) + ',"createdAt":' + i))) sum += total(r) + (r as any)[CREATED];
console.log(sum);
