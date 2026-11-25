// An eval in a computed key runs before the decorators of the class are applied: the pair of a decorated private accessor is not made yet, and nothing may be read off it there.
const same = (_: any, __: any): any => undefined;
function make(a: number): any {
  return class {
    @same accessor #x = a;
    [eval("'k'") as string](): number {
      return this.#x * 2;
    }
  };
}
console.log(new (make(3))().k());
export {};
