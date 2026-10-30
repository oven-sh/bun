// Module namespace objects spread into object literals: alone, between fields, twice, conditionally, inside try, through barrel files, through a CommonJS module, and while a binding is still in its TDZ.
import * as many from "./many";
import * as barrel from "./barrel";
import * as few from "./few";
import * as through from "./through";
import * as cycle from "./cycle";
import * as odd from "./odd.js";
const show = (value: unknown): string => JSON.stringify(value, (key, held) => typeof held === "function" ? "function " + held.name : held === undefined ? "undefined" : held);
const digest = (value: object): string => { const text = show(value); let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return Object.keys(value).length + ":" + h; };
console.log(digest({ ...many }), Object.keys({ ...many }).slice(0, 6).join(), Object.keys({ ...many }).slice(-4).join());
console.log(show({ ...few }), show({ first: 1, ...few, alpha: "over", last: 2 }), show({ alpha: "under", ...(few as Record<string, unknown>) }));
console.log(digest({ ...barrel }), show({ ...barrel }.inner), show({ ...barrel }.renamed), "default" in { ...barrel }, "default" in { ...many });
console.log(show({ ...through }), show({ a: 1, ...through, own: "over" }));
console.log(show({ ...few, ...through }), digest({ ...many, ...few, ...many }));
many.change(); few.setLate();
console.log({ ...many }.n001, { ...few }.late, show({ ...(few.late > 1 ? few : through) }), show({ ...(few.late > 100 && few) }));
const copy = { ...few } as Record<string, unknown>;
console.log(Object.getPrototypeOf(copy) === Object.prototype, Object.isExtensible(copy), show(Object.getOwnPropertyDescriptor(copy, "zulu")), Symbol.toStringTag in copy, Object.getOwnPropertySymbols(copy).length);
copy.zulu = "changed"; delete copy.alpha; copy.added = true;
console.log(few.zulu, show(copy));
function inside(): string { try { return digest({ x: 1, ...(many as object), y: 2 }); } catch (e) { return "caught"; } }
console.log(inside(), inside() === inside());
console.log({ ...many }.n002 === many.n002, { ...many }.N003 === many.N003, { ...many }.n004 === many.n004, new ({ ...many }.N003)().value);
console.log(show(cycle.seen));
let sum = 0; for (let i = 0; i < 2000; i++) sum += Object.keys({ i, ...few }).length + ({ ...few } as { late: number }).late; console.log(sum);
const oddCopy = { ...odd } as Record<string, unknown>;
console.log(Object.keys(oddCopy).join("|"), show(oddCopy), Object.getPrototypeOf(oddCopy) === Object.prototype, Object.hasOwn(oddCopy, "__proto__"), Object.keys({ z: 1, ...odd, "5": 5 }).join("|"));
