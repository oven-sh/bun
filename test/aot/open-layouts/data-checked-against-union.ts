interface Settings { tag: "settings"; a: number; b: number; c: number; d: number; e: number; f: number; g: number; }
interface Small { tag: "small"; a: number; }
interface Tree { tag: "tree"; a: number; b: number; c: number; d: number; e: number; f: number; left: Tree | undefined; }
const kept: unknown[] = [];
function keep(data: any): any { kept.push(data); return data; }
function read(text: string): Settings | Small | Tree { return keep(JSON.parse(text)); }
function describe(x: Settings | Small | Tree): string {
    switch (x.tag) {
        case "settings": return "settings " + x.g;
        case "small": return "small " + x.a;
        case "tree": return "tree " + x.a + (x.left ? " over " + describe(x.left) : "");
    }
}
const texts = ['{"tag":"settings","a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":70}', '{"tag":"small","a":5}', '{"tag":"tree","a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"left":{"tag":"tree","a":2,"b":2,"c":3,"d":4,"e":5,"f":6}}'];
texts.forEach((text, index) => { const value = read(text); console.log(describe(value), value === kept[index]); });
const made: Tree = { tag: "tree", a: 9, b: 1, c: 2, d: 3, e: 4, f: 5, left: undefined };
console.log(describe(made), describe({ tag: "small", a: 6 }));
