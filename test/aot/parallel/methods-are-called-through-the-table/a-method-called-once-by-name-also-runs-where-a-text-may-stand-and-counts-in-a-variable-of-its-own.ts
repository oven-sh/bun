class Base { replace(what: unknown, by: unknown): unknown { return 0; } }
class A extends Base { replace(what: unknown, by: unknown): unknown { let count = 0; return () => { count += 1; return count; }; } }
class B extends Base { replace(what: unknown, by: unknown): unknown { return () => "B"; } }
const nobodyKnows: (found: string) => string = (globalThis as any).swap ?? ((found: string) => found.toUpperCase());
function swap(text: Base | string, by: any): unknown { return text.replace("x", by); }
const first = swap(new A(), nobodyKnows) as () => unknown;
const other = swap(new B(), nobodyKnows) as () => unknown;
const text = swap("axb", nobodyKnows);
const second = new A().replace("x", 1) as () => unknown;
console.log(first(), first(), second(), other(), text);
