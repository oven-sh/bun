// A loop over names whose turns are written out for some classes walks the objects of others as it was written.
let failures = 0;
const check = (name, found, expected) => { if (!Object.is(found, expected) && ++failures < 20) console.log(name, "is", found, "and not", expected); };
class Buoy { constructor() { this.rope = {}; this.barrel = null; this.tint = "buoy"; } }
class Boat extends Buoy { constructor() { super(); this.hooks = []; this.tint = "boat"; this.lanterns = "s"; } }
const lengths = object => { let sum = 0; for (const name in object) sum += name.length; return sum; };
const values = object => { let sum = 0; for (const name in object) if (object[name]) ++sum; return sum; };
const until = (object, stop) => { let found = ""; for (const name in object) { if (name === stop) break; found += name; object.grown = 1; } return found; };
const remove = (object, removed) => { let found = ""; for (const name in object) { found += name; if (name.length === 1) delete object[removed]; } return found; };
const build = object => { const made = {}; for (const name in object) made[name] = object[name]; return made; };
const objects = [new Boat(), { a: 1, b: 0, c: 3 }, new Buoy(), { long: 1, a: 2 }, Object.assign(new Boat(), { candlewick: 1 }), Object.create({ inherited: 1, b: 2 }), [1, 0], "ab", null, Object.assign(Object.create(null), { z: 1 })];
for (let round = 0; round < 300; ++round) {
    const list = objects.map(lengths).join();
    check("lengths", list, "27,3,14,5,37,10,2,2,0,1");
    check("values", objects.map(values).join(), "4,2,2,2,5,2,1,2,0,1");
    check("until", until({ a: 1, b: 2, c: 3 }, round & 1 ? "c" : "z"), round & 1 ? "ab" : "abc");
    check("until of class", until(new Boat(), round & 1 ? "tint" : "z"), round & 1 ? "ropebarrel" : "ropebarreltinthookslanterns");
    check("remove", remove({ a: 1, b: 2, c: 3 }, round & 1 ? "b" : "c"), round & 1 ? "ac" : "ab");
    check("remove of class", remove(Object.assign(new Buoy(), { q: 1, last: 2 }), round & 1 ? "last" : "barrel"), round & 1 ? "ropebarreltintq" : "ropebarreltintqlast");
    check("build", Object.keys(build(objects[round % objects.length])).length, [5, 3, 3, 2, 6, 2, 2, 2, 0, 1][round % objects.length]);
}
console.log("ended", failures);
