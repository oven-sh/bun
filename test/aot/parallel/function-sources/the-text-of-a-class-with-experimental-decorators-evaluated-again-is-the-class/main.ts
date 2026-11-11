// An experimental decorator is applied by code behind the class, so the text of the class is the class without it, as under `bun run`. Until then the text held `@seen` and did not parse.
const told: string[] = [];
function seen(target: any, key?: any, at?: any) {
  told.push(String(key));
}
function named(name: string) {
  return (target: any, key?: any, at?: any) => void told.push(name);
}
@seen
class Whole {
  @seen
  run() {
    return 1;
  }
  take(@seen first = 2, @named("second") @seen second = 3) {
    return first + second;
  }
  @named("field") field = 4;
  @seen get twice() {
    return this.field * 2;
  }
}
const Again = (0, eval)("(" + Whole + ")");
const made = new Again();
console.log(made.run(), made.take(), made.field, made.twice, told.length);
console.log((0, eval)("({" + Whole.prototype.take + "})").take());
