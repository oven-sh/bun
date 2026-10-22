// An export that no import names is still observed through the namespace object: by listings of its keys, a computed key, console.log, an heir, a dynamic import, copies and descriptors.
import * as a from "./a";
import * as b from "./b";
import * as c from "./c";
import * as d from "./d";
import * as e from "./e";
console.log(a.used);
console.log(Object.keys(b).join(), Object.getOwnPropertyNames(b).length, Reflect.ownKeys(b).map(String).join());
const key: string = ["via", "Key"].join("");
console.log((c as any)[key], key in c, Object.hasOwn(c, "other"));
console.log(d);
const heir: any = Object.create(e);
console.log(heir.inherited, "second" in heir);
let names = "";
for (const name in heir) names += name + ";";
console.log(names);
const late = await import("./a");
console.log(Object.keys(late).join(), late.neverCalled(), late.unused.deep, new late.default().tag);
late.bump();
console.log(a.changing, late.changing, late === a);
console.log(JSON.stringify(a), Object.entries(b).length, { ...c }.other, Object.assign({}, e).second);
console.log(Object.getOwnPropertyDescriptor(a, "unused")?.enumerable, Object.isFrozen(b), Object.isSealed(b), Object.isExtensible(b), String((a as any)[Symbol.toStringTag]));
try { (a as any).used = 5; console.log("stored"); } catch (error: any) { console.log(error.name); }
try { delete (a as any).unused; console.log("deleted"); } catch (error: any) { console.log(error.name); }
