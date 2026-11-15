// The same where the class is a declaration of the file: the pair lies in a variable of the file and not in an environment.
const same = (_: any, __: any): any => undefined;
class Box {
  @same accessor #x = 3;
  [eval("'k'") as string](): number {
    return this.#x * 2;
  }
}
console.log((new Box() as any).k());
export {};
