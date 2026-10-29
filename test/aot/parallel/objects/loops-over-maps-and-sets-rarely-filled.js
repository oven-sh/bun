// Loops over a Map or a Set that the program never fills, fills on one path only, or hands to code that fills it.
const lines = [];
const say = (...values) => lines.push(values.join(" "));

const neverFilledMap = new Map();
for (const entry of neverFilledMap) say("entry", entry);
for (const [key, value] of neverFilledMap) say("pair", key, value);
for (const key of neverFilledMap.keys()) say("key", key);
for (const value of neverFilledMap.values()) say("value", value);
neverFilledMap.forEach((value, key) => say("forEach", key, value));
say("after the empty map", neverFilledMap.size, [...neverFilledMap].length);

const neverFilledSet = new Set();
for (const element of neverFilledSet) say("element", element);
for (const [first, second] of neverFilledSet.entries()) say("entries", first, second);
neverFilledSet.forEach(element => say("forEach", element));
say("after the empty set", neverFilledSet.size, [...neverFilledSet].length);

function fillOnOnePath(fill) {
    const map = new Map();
    const set = new Set();
    if (fill) {
        map.set("a", 1);
        set.add("b");
    }
    let text = "";
    for (const [key, value] of map) text += key + value;
    for (const element of set) text += element.length;
    map.forEach((value, key) => { text += key.toUpperCase() + (value + 1); });
    set.forEach(element => { text += element.toUpperCase(); });
    return text + "|";
}
say("one path", fillOnOnePath(false), fillOnOnePath(true), fillOnOnePath(false));

function fillThrough(fillers) {
    const map = new Map();
    const set = new Set();
    for (const fill of fillers) fill(map, set);
    let text = "";
    for (const [key, value] of map) text += String(key) + String(value);
    for (const element of set) text += String(element);
    return text + "|";
}
const fillers = JSON.parse("[0, 1]").map(n => n ? (map, set) => { map.set(n, undefined); set.add(undefined); } : () => { });
say("filled elsewhere", fillThrough([]), fillThrough(fillers));

const filledByBuiltIn = new Set();
["x", "yz"].forEach(Set.prototype.add, filledByBuiltIn);
for (const element of filledByBuiltIn) say("added by a built-in", element.length);
const filledByReflect = new Map();
Reflect.apply(Map.prototype.set, filledByReflect, ["k", "v"]);
for (const [key, value] of filledByReflect) say("set by a built-in", key + value);
const filledThroughBound = new Map();
const setBound = filledThroughBound.set.bind(filledThroughBound);
[["b", 2]].forEach(pair => setBound(...pair));
for (const [key, value] of filledThroughBound) say("set through a bound function", key, value + 1);

const holdsUndefined = new Map([[undefined, undefined]]);
for (const [key, value] of holdsUndefined) say("undefined entry", key, value);

class SetHeir extends Set { }
class MapHeir extends Map { }
const setHeir = new SetHeir(["a", "bc"]);
const emptySetHeir = new SetHeir();
const mapHeir = new MapHeir([["k", "v"]]);
let total = 0;
setHeir.forEach(element => { total += element.length; });
for (const element of setHeir) total += element.length;
emptySetHeir.forEach(element => { total += element.length; });
for (const element of emptySetHeir) total += element.length;
mapHeir.forEach((value, key) => { total += value.length + key.length; });
for (const [key, value] of new MapHeir()) total += key.length + value.length;
say("subclasses", total);

console.log(lines.join("\n"));
