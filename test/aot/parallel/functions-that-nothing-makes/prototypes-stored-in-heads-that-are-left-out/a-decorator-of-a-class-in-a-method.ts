// A decorator of a class in a method of an unused class stores a literal as a prototype in a function, and nothing makes the function. The build does not name it.
const base: any = {
  size() {
    return this.v + 1;
  },
};
export const holds = (value: any) => base.isPrototypeOf(value);
const take = (_f: any) => (..._a: any[]): any => {};
class Unused {
  m() {
    @take(
      (function () {
        var Inner: any = function (this: any, v: number) {
          this.v = v;
        };
        Inner.prototype = base;
        if (!Inner) Inner = null;
        return Inner;
      })(),
    )
    class Inside {}
    return Inside;
  }
}
console.log(holds({}));
