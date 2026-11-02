// Counts how often the expression of a computed key runs where the member carries a decorator of `experimentalDecorators`: once, as in what TypeScript's compiler emits.
const counts: Record<string, number> = {};
function key<T extends string>(name: T): T {
  counts[name] = (counts[name] ?? 0) + 1;
  return name;
}
const seen: string[] = [];
const mark: any = (_target: object, name: string) => {
  seen.push(name);
};
class Marked {
  @mark [key("method")]() {
    return 1;
  }
  @mark static [key("static method")]() {
    return 2;
  }
  @mark get [key("getter")]() {
    return 3;
  }
  @mark set [key("setter")](next: number) {}
  [key("no decorator")]() {
    return 4;
  }
}
console.log(JSON.stringify(counts));
console.log(seen.join(", "));
const made: any = new Marked();
console.log(made.method(), (Marked as any)["static method"](), made.getter, made["no decorator"]());
/* Output:
{"method":1,"static method":1,"getter":1,"setter":1,"no decorator":1}
method, getter, setter, static method
1 2 3 4
*/
