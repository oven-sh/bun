// The same where the computed key with the eval is written above the accessor.
const same = (_: any, __: any): any => undefined;
function make(a: number): any {
  return class {
    [eval("'k'") as string](): number {
      return this.#x * 2;
    }
    @same accessor #x = a;
  };
}
console.log(new (make(3))().k());
export {};
