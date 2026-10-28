// The prototype objects go through a long list, a Map, a WeakMap, a closure, a promise and parsed names before a store puts the name of a field that most objects leave empty on them.
import { Old, Point, round } from "../objects-with-a-field-left-empty";

const bag: any[] = [];
for (let index = 0; index < 100; index++) bag.push({ index }, [index], () => index, String(index));
bag.push(Point.prototype, (Old as any).prototype);
const names = JSON.parse('{"name":"late"}');
round("before");
bag[400][names.name] = "text";
round("out of a long list");
delete bag[400][names.name];
const map = new Map<string, any>([["old", bag[401]]]);
map.get("old")[names.name] = 7;
round("out of a Map");
delete map.get("old")[names.name];
const weak = new WeakMap<object, any>([[names, bag[400]]]);
const keep = (held => () => held)(weak.get(names));
keep().late = { x: "x", y: 1 };
round("out of a WeakMap and a closure");
delete keep().late;
const settled = await Promise.resolve(map).then(held => held.get("old"));
Object.defineProperty(settled, names.name, { get: () => null, configurable: true });
round("out of a promise");
