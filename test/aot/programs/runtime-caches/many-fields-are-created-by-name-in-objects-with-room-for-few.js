// A layout with many fields that few objects fill keeps most of them outside the cell. Stores by name create them there.
const lines = [];
const names = ["n0", "n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12", "n13", "n14", "n15", "n16", "n17", "n18", "n19"];
// Six layouts have the names, so that a site which is told nothing cannot guess which one comes.
class Kind0 {
    constructor(id) {
        this.id = id;
        this.kind = 0;
    }
    fill() {
        this.n0 = "s0";
        this.n1 = "s1";
        this.n2 = "s2";
        this.n3 = "s3";
        this.n4 = "s4";
        this.n5 = "s5";
        this.n6 = "s6";
        this.n7 = "s7";
        this.n8 = "s8";
        this.n9 = "s9";
        this.n10 = "s10";
        this.n11 = "s11";
        this.n12 = "s12";
        this.n13 = "s13";
        this.n14 = "s14";
        this.n15 = "s15";
        this.n16 = "s16";
        this.n17 = "s17";
        this.n18 = "s18";
        this.n19 = "s19";
        return this;
    }
}
class Kind1 {
    constructor(id) {
        this.id = id;
        this.kind = 1;
    }
    fill() {
        this.n0 = "s0";
        this.n1 = "s1";
        this.n2 = "s2";
        this.n3 = "s3";
        this.n4 = "s4";
        this.n5 = "s5";
        this.n6 = "s6";
        this.n7 = "s7";
        this.n8 = "s8";
        this.n9 = "s9";
        this.n10 = "s10";
        this.n11 = "s11";
        this.n12 = "s12";
        this.n13 = "s13";
        this.n14 = "s14";
        this.n15 = "s15";
        this.n16 = "s16";
        this.n17 = "s17";
        this.n18 = "s18";
        this.n19 = "s19";
        return this;
    }
}
class Kind2 {
    constructor(id) {
        this.id = id;
        this.kind = 2;
    }
    fill() {
        this.n0 = "s0";
        this.n1 = "s1";
        this.n2 = "s2";
        this.n3 = "s3";
        this.n4 = "s4";
        this.n5 = "s5";
        this.n6 = "s6";
        this.n7 = "s7";
        this.n8 = "s8";
        this.n9 = "s9";
        this.n10 = "s10";
        this.n11 = "s11";
        this.n12 = "s12";
        this.n13 = "s13";
        this.n14 = "s14";
        this.n15 = "s15";
        this.n16 = "s16";
        this.n17 = "s17";
        this.n18 = "s18";
        this.n19 = "s19";
        return this;
    }
}
class Kind3 {
    constructor(id) {
        this.id = id;
        this.kind = 3;
    }
    fill() {
        this.n0 = "s0";
        this.n1 = "s1";
        this.n2 = "s2";
        this.n3 = "s3";
        this.n4 = "s4";
        this.n5 = "s5";
        this.n6 = "s6";
        this.n7 = "s7";
        this.n8 = "s8";
        this.n9 = "s9";
        this.n10 = "s10";
        this.n11 = "s11";
        this.n12 = "s12";
        this.n13 = "s13";
        this.n14 = "s14";
        this.n15 = "s15";
        this.n16 = "s16";
        this.n17 = "s17";
        this.n18 = "s18";
        this.n19 = "s19";
        return this;
    }
}
class Kind4 {
    constructor(id) {
        this.id = id;
        this.kind = 4;
    }
    fill() {
        this.n0 = "s0";
        this.n1 = "s1";
        this.n2 = "s2";
        this.n3 = "s3";
        this.n4 = "s4";
        this.n5 = "s5";
        this.n6 = "s6";
        this.n7 = "s7";
        this.n8 = "s8";
        this.n9 = "s9";
        this.n10 = "s10";
        this.n11 = "s11";
        this.n12 = "s12";
        this.n13 = "s13";
        this.n14 = "s14";
        this.n15 = "s15";
        this.n16 = "s16";
        this.n17 = "s17";
        this.n18 = "s18";
        this.n19 = "s19";
        return this;
    }
}
class Kind5 {
    constructor(id) {
        this.id = id;
        this.kind = 5;
    }
    fill() {
        this.n0 = "s0";
        this.n1 = "s1";
        this.n2 = "s2";
        this.n3 = "s3";
        this.n4 = "s4";
        this.n5 = "s5";
        this.n6 = "s6";
        this.n7 = "s7";
        this.n8 = "s8";
        this.n9 = "s9";
        this.n10 = "s10";
        this.n11 = "s11";
        this.n12 = "s12";
        this.n13 = "s13";
        this.n14 = "s14";
        this.n15 = "s15";
        this.n16 = "s16";
        this.n17 = "s17";
        this.n18 = "s18";
        this.n19 = "s19";
        return this;
    }
}
function base(id) {
    switch (((id % 6) + 6) % 6) {
    case 0: return new Kind0(id);
    case 1: return new Kind1(id);
    case 2: return new Kind2(id);
    case 3: return new Kind3(id);
    case 4: return new Kind4(id);
    default: return new Kind5(id);
    }
}
// What comes out of evaluated text is anything: nothing is proven about the receivers.
const hide = (0, eval)("(value) => value");
function put(given, index, value) {
    const object = hide(given);
    switch (index) {
    case 0: object.n0 = value; break;
    case 1: object.n1 = value; break;
    case 2: object.n2 = value; break;
    case 3: object.n3 = value; break;
    case 4: object.n4 = value; break;
    case 5: object.n5 = value; break;
    case 6: object.n6 = value; break;
    case 7: object.n7 = value; break;
    case 8: object.n8 = value; break;
    case 9: object.n9 = value; break;
    case 10: object.n10 = value; break;
    case 11: object.n11 = value; break;
    case 12: object.n12 = value; break;
    case 13: object.n13 = value; break;
    case 14: object.n14 = value; break;
    case 15: object.n15 = value; break;
    case 16: object.n16 = value; break;
    case 17: object.n17 = value; break;
    case 18: object.n18 = value; break;
    case 19: object.n19 = value; break;
    }
}
let seed = 12345;
function next(limit) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed % limit;
}
const kept = [];
for (let kind = -6; kind < 0; ++kind)
    kept.push(base(kind).fill());
for (let id = 0; id < 400; ++id) {
    const object = base(id);
    const howMany = id % 7 === 0 ? 20 : next(4);
    for (let step = 0; step < howMany; ++step) {
        const index = next(20);
        const kind = next(6);
        put(object, index, kind === 0 ? undefined : kind === 1 ? "s" + step : kind === 2 ? step : kind === 3 ? { step } : kind === 4 ? null : step + 0.5);
    }
    if (id % 11 === 0)
        delete object["n" + next(20)];
    if (id % 13 === 0)
        Object.preventExtensions(object);
    if (id % 13 === 0 || id % 17 === 0) {
        try {
            (function () { "use strict"; put(object, next(20), "late"); })();
        } catch (error) {
            lines.push(id + " " + error.constructor.name);
        }
    }
    kept.push(object);
}
let digest = 0;
for (const object of kept) {
    const text = JSON.stringify(object) + Object.keys(object).join() + names.map(name => (name in object ? "1" : "0")).join("");
    for (let index = 0; index < text.length; ++index)
        digest = (digest * 31 + text.charCodeAt(index)) | 0;
}
lines.push("digest " + digest);
for (const id of [0, 1, 7, 13, 26, 34, 77, 143, 221, 399])
    lines.push(id + " " + JSON.stringify(kept[id]) + " " + Object.keys(kept[id]).join());
console.log(lines.join("\n"));
