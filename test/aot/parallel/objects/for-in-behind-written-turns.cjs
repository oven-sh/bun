// A loop over names whose turns are written out for some classes walks the objects of others as it was written.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
class Node { constructor() { this.type = "node"; this.raws = {}; this.source = null; } }
class Rule extends Node { constructor() { super(); this.type = "rule"; this.selector = "s"; this.nodes = []; } }
const lengths = object => { let sum = 0; for (const name in object) sum += name.length; return sum; };
const values = object => { let sum = 0; for (const name in object) if (object[name]) ++sum; return sum; };
const until = (object, stop) => { let found = ""; for (const name in object) { if (name === stop) break; found += name; object.grown = 1; } return found; };
const remove = (object, removed) => { let found = ""; for (const name in object) { found += name; if (name.length === 1) delete object[removed]; } return found; };
const build = object => { const made = {}; for (const name in object) made[name] = object[name]; return made; };
const objects = [new Rule(), { a: 1, b: 0, c: 3 }, new Node(), { long: 1, a: 2 }, Object.assign(new Rule(), { proxyCache: 1 }), Object.create({ inherited: 1, b: 2 }), [1, 0], "ab", null, Object.assign(Object.create(null), { z: 1 })];
for (let round = 0; round < 300; ++round) {
    const list = objects.map(lengths).join();
    check("lengths", list, "27,3,14,5,37,10,2,2,0,1");
    check("values", objects.map(values).join(), "4,2,2,2,5,2,1,2,0,1");
    check("until", until({ a: 1, b: 2, c: 3 }, round & 1 ? "c" : "z"), round & 1 ? "ab" : "abc");
    check("until of class", until(new Rule(), round & 1 ? "source" : "z"), round & 1 ? "typeraws" : "typerawssourceselectornodes");
    check("remove", remove({ a: 1, b: 2, c: 3 }, round & 1 ? "b" : "c"), round & 1 ? "ac" : "ab");
    check("remove of class", remove(Object.assign(new Node(), { q: 1, last: 2 }), round & 1 ? "last" : "raws"), round & 1 ? "typerawssourceq" : "typerawssourceqlast");
    check("build", Object.keys(build(objects[round % objects.length])).length, [5, 3, 3, 2, 6, 2, 2, 2, 0, 1][round % objects.length]);
}
console.log("ended", failures);
