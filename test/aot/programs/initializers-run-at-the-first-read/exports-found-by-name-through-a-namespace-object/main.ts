// Namespace objects that only reads under known names look into. An export that such a read finds by its name while the program runs is there when the read comes,
// whether or not other code reads the same export by an import.
import * as beside from "./beside";
import * as throughThis from "./through-this";
import * as tested from "./tested";
import * as handed from "./handed";
import * as inherited from "./inherited";
import { table as tableOfHanded } from "./handed";

const log: string[] = [];
const show = (map: Map<string, number>) => JSON.stringify([...map]);

// Two receivers at one site: the name is read at run time.
const other = { table: new Map([["other", 0]]), size() { return -1; } };
function pick(flag: boolean) { return (flag ? beside : other).table; }
function call(flag: boolean) { return (flag ? beside : other).size(); }
log.push(show(pick(false)), show(pick(true)), String(call(false)), String(call(true)));

// `this` of a call through the namespace object is the object.
log.push(String(throughThis.sizeOfMine()), String(throughThis.growMine("ccc")), show(throughThis.table));

// Tests for a name, and a description of the property.
log.push(String("table" in tested), String(Object.hasOwn(tested, "table")), String("missing" in tested));
log.push(JSON.stringify(Object.getOwnPropertyDescriptor(tested, "list")));

// The object handed on as a value, read under a name by code that takes any object with that name.
function sizeOf(holder: { table: Map<string, number> }) { return holder.table.size; }
log.push(String(sizeOf(handed)), String(sizeOf(other)), String(handed.table === tableOfHanded));

// The object as a prototype: the read climbs to it.
const heir: { table?: Map<string, number> } = Object.create(inherited);
log.push(show(heir.table!));

console.log(log.join("\n"));
