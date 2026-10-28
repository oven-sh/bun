interface Settings { tag: "settings"; a: number; b: number; c: number; d: number; e: number; f: number; g: number; }
interface Tree { tag: "tree"; a: number; b: number; c: number; d: number; e: number; f: number; left: Tree | undefined; twig: Twig | undefined; }
interface Twig { tag: "twig"; a: number; b: number; c: number; d: number; e: number; f: number; g: number; }
interface Fruit { tag: "fruit"; a: number; b: number; c: number; d: number; e: number; f: number; g: number; }
const kept: unknown[] = [];
function keep(data: any): any { kept.push(data); return data; }
function total(settings: Settings): number { return settings.a + settings.g; }
function makeTwig(n: number): Twig { return { tag: "twig", a: n, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6 }; }
function makeFruit(n: number): Fruit { return { tag: "fruit", a: n, b: 1, c: 2, d: 3, e: 4, f: 5, g: 7 }; }
function makeTree(n: number, left: Tree | undefined): Tree { return { tag: "tree", a: n, b: 1, c: 2, d: 3, e: 4, f: 5, left, twig: makeTwig(n) }; }
function first(x: Settings | Tree): number { return x.tag === "tree" ? x.a + (x.twig ? x.twig.g : 0) + (x.left ? first(x.left) : 0) : x.g; }
function second(x: Twig | Fruit): number { return x.tag === "twig" ? x.g : -x.g; }
const settings: Settings = keep(JSON.parse('{"tag":"settings","a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":70}'));
console.log(total(settings), first(settings), first(makeTree(1, makeTree(2, undefined))), second(makeTwig(1)), second(makeFruit(1)), settings === kept[0]);
