// What a call of at() says where there is nothing to call it on.
const say = (f: () => unknown): string => { try { return String(f()); } catch (e) { return (e as Error).constructor.name + ": " + (e as Error).message; } };
function untyped(value: any): unknown { return value.at(-1); }
function named(value: any): unknown { return value.name.at(0); }
function typed(list: number[] | undefined): unknown { return list!.at(-1); }
function inLoop(value: any): unknown { let last: unknown; for (let i = 0; i < 3; i++) last = value.items.at(i); return last; }
for (const value of [undefined, null, 5, {}, { name: undefined, items: null }, { name: 5, items: {} }, { name: [1], items: [1, 2, 3] }] as any[]) console.log([untyped, named, inLoop].map(f => say(() => f(value))).join(" | "));
console.log(say(() => typed(undefined)), say(() => typed([4])));
