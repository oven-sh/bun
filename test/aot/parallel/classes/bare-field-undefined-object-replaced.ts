// The parent of a class is replaced by a function that keeps the object it returns and makes a later field read-only, so the constructor stops half way.
const kept: object[] = [];
class Above {}
class Below extends Above {
  count: number;
  label: string;
  constructor(count: number) {
    super();
    this.count = count;
    this.label = "s";
  }
}
Object.setPrototypeOf(Below, function () {
  const made = {};
  kept.push(made);
  Object.defineProperty(made, "label", { value: "fixed" });
  return made;
});
try {
  new Below(1);
} catch (error) {
  console.log((error as Error).name);
}
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(kept[0], "count")));
