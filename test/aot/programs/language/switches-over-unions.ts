declare const console: { log(...values: unknown[]): void };
type Two = { kind: "on"; level: number } | { kind: "off" };
type Three = { kind: "a"; x: number } | { kind: "b"; y: number } | { kind: "c"; z: string };
type Shape = { kind: "circle"; radius: number } | { kind: "square"; side: number } | { kind: "rectangle"; width: number; height: number } | { kind: "triangle"; base: number; height: number };
type Five = { tag: 0; v: number } | { tag: 1; v: string } | { tag: 2; v: boolean } | { tag: 3; v: null } | { tag: 4; v: number[] };

function two(values: Two[]): number {
    let t = 0;
    for (const value of values) {
        switch (value.kind) {
            case "on": t += value.level; break;
            case "off": t -= 1; break;
        }
    }
    return t;
}
function twoByIf(values: Two[]): number {
    let t = 0;
    for (const value of values) {
        if (value.kind === "on") t += value.level;
        else t -= 1;
    }
    return t;
}
function three(values: Three[]): string {
    let t = "";
    for (const value of values) {
        switch (value.kind) {
            case "a": t += value.x; break;
            case "c": t += value.z;
            case "b": t += "|"; break;
        }
    }
    return t;
}
function area(shapes: Shape[], last: Shape): number {
    let t = 0;
    for (let i = 0; i < shapes.length; i++) {
        const s = shapes[i];
        if (s === last) t += 1;
        switch (s.kind) {
            case "circle": t += s.radius; break;
            case "square": t -= s.side; break;
            case "rectangle": t += s.width * s.height; break;
            case "triangle": t += s.base - s.height; break;
        }
    }
    return t;
}
function areaWithDefault(shapes: Shape[]): number {
    let t = 0;
    for (const s of shapes) {
        switch (s.kind) {
            case "triangle": t += s.base - s.height; break;
            case "circle": t += s.radius; break;
            default: t += 1000; break;
        }
    }
    return t;
}
function areaByIfs(shapes: Shape[]): number {
    let t = 0;
    for (const s of shapes) {
        if (s.kind === "circle") t += s.radius;
        else if (s.kind === "square") t -= s.side;
        else if (s.kind !== "rectangle") t += s.base - s.height;
        else t += s.width * s.height;
    }
    return t;
}
function five(values: Five[]): string {
    let t = "";
    for (const value of values) {
        switch (value.tag) {
            case 0: t += value.v + 1; break;
            case 1: t += value.v + "!"; break;
            case 2: t += value.v ? "yes" : "no"; break;
            case 3: t += value.v; break;
            case 4: t += value.v.length; break;
        }
        t += ",";
    }
    return t;
}
function nameOf(s: Shape | undefined | null): string {
    if (!s) return "nothing";
    switch (s.kind) {
        case "circle": return "circle " + s.radius;
        case "square": return "square " + s.side;
        case "rectangle": return "rectangle " + s.width + " " + s.height;
        case "triangle": return "triangle " + s.base + " " + s.height;
    }
}

const twos: Two[] = [];
for (let i = 0; i < 40; i++) twos.push(i % 3 ? { kind: "on", level: i } : { kind: "off" });
console.log(two(twos), twoByIf(twos));
const threes: Three[] = [];
for (let i = 0; i < 12; i++) threes.push(i % 3 === 0 ? { kind: "a", x: i } : i % 3 === 1 ? { kind: "b", y: i } : { kind: "c", z: "z" + i });
console.log(three(threes));
const shapes: Shape[] = [];
let seed = 12345;
for (let i = 0; i < 200; i++) {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    const k = Math.floor(seed / 65536) % 4;
    shapes.push(k === 0 ? { kind: "circle", radius: i } : k === 1 ? { kind: "square", side: i } : k === 2 ? { kind: "rectangle", width: i, height: 2 } : { kind: "triangle", base: i, height: 3 });
}
console.log(area(shapes, shapes[199]), areaWithDefault(shapes), areaByIfs(shapes));
const fives: Five[] = [{ tag: 0, v: 41 }, { tag: 1, v: "one" }, { tag: 2, v: true }, { tag: 2, v: false }, { tag: 3, v: null }, { tag: 4, v: [1, 2, 3] }];
console.log(five(fives));
console.log(nameOf(undefined), nameOf(null), nameOf(shapes[0]), nameOf(shapes[1]), nameOf(shapes[2]), nameOf(shapes[3]), nameOf(shapes[4]));

const parsed = JSON.parse('[{"kind":"circle","radius":2},{"kind":"triangle","height":1,"base":9},{"side":4,"kind":"square"},{"kind":"rectangle","width":3,"height":5,"more":1}]') as Shape[];
console.log(area(parsed, parsed[1]), areaWithDefault(parsed), areaByIfs(parsed), nameOf(parsed[0]), nameOf(parsed[1]), nameOf(parsed[2]), nameOf(parsed[3]));
const mixed: Shape[] = shapes.slice(0, 10).concat(parsed);
console.log(area(mixed, parsed[3]), areaWithDefault(mixed), areaByIfs(mixed));
const kindBuilt = ["cir", "cle"].join("");
const built: Shape[] = [{ kind: kindBuilt as "circle", radius: 7 }, { kind: ("squ" + "are".slice(0)) as "square", side: 2 }];
console.log(area(built, built[0]), areaWithDefault(built), areaByIfs(built), nameOf(built[0]), nameOf(built[1]));
const parsedTwos = JSON.parse('[{"kind":"off"},{"level":5,"kind":"on"},{"kind":"on","level":6}]') as Two[];
console.log(two(parsedTwos), twoByIf(parsedTwos), two(twos.concat(parsedTwos)));
const parsedFives = JSON.parse('[{"tag":4,"v":[9]},{"v":"s","tag":1},{"tag":0,"v":1.5},{"tag":3,"v":null}]') as Five[];
console.log(five(parsedFives), five(fives.concat(parsedFives)));
console.log(area(shapes, shapes[199]), areaWithDefault(shapes), areaByIfs(shapes), two(twos), three(threes), five(fives));
