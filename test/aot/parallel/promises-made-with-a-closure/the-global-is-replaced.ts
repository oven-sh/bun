const out: string[] = [];
const Real = Promise;
function make(i: number) { return new Promise<number>(resolve => resolve(i)); }
out.push(String(make(1) instanceof Real));
(globalThis as any).Promise = class Fake { constructor(public executor: unknown) { out.push("the fake is made"); } };
out.push(String(make(2) instanceof Real), make(3).constructor.name);
(globalThis as any).Promise = Real; out.push(String(make(4) instanceof Real));
console.log(out.join(" | "));
