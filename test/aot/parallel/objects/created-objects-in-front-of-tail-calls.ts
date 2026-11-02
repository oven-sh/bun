function describe(x: object): string { return Object.keys(x).join() + typeof x; }
function viaTail(p: object | null): string { const made = Object.create(p); made.a = 1; return describe(made); }
function viaTailUnknown(p: object | null, f: (x: any) => any): number { const made = Object.create(p); made.b = 2; return f(made); }
function twoAndTail(p: object | null): string { const first = Object.create(p), second = Object.create(first); second.c = 3; return describe(second); }
console.log(viaTail(null), viaTail({ z: 1 }), viaTailUnknown(null, x => x.b), twoAndTail(null));
