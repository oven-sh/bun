// An interface with `name` takes a function, a class, a built-in function and an Error
interface Named {
  name: string;
}
function tell(v: Named): string {
  return v.name + "|" + typeof v + "|" + (v instanceof Function) + "|" + Object.keys(v).join();
}
class Klass {
  static extra = 1;
}
const list: Named[] = [{ name: "plain" }, function fn() {}, Klass, Math.max, new Error("e")];
for (let round = 0; round < 3; round++) for (const v of list) console.log(tell(v));
