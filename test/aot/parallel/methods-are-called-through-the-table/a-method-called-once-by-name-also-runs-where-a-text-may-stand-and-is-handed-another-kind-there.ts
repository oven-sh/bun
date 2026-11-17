class Base { replace(what: unknown, by: unknown): unknown { return 0; } }
class A extends Base {
  replace(what: unknown, by: unknown): unknown {
    let sum = 0;
    for (let turn = 0; turn < 3; turn++) sum += typeof by === "number" ? by : typeof by === "function" ? 100 : -1;
    return sum;
  }
}
class B extends Base { replace(what: unknown, by: unknown): unknown { return typeof by; } }
const nobodyKnows: (found: string) => string = (globalThis as any).swap ?? ((found: string) => found.toUpperCase());
function swap(text: Base | string, by: any): unknown { return text.replace("x", by); }
function direct(a: A): unknown { return a.replace("x", 7); }
console.log(swap(new A(), nobodyKnows), swap(new B(), nobodyKnows), swap("axb", nobodyKnows), direct(new A()));
