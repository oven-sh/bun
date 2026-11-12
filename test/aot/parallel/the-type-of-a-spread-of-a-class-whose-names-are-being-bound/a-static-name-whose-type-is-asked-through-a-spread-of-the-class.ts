function pick<Value>(value: Value): "late" {
  return "late";
}
function probe() {
  return pick({ ...Kept, extra: 0 });
}
const a: ReturnType<typeof probe> = "late";
class Kept {
  static early = 1;
  static [a] = 2;
}
const first = { ...Kept, extra: 1 };
const second = { ...Kept, extra: 2 };
console.log("SAID " + first.early + " " + first.late + " " + second.early + " " + second.late);
