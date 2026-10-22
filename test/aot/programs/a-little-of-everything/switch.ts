// switch over numbers, strings and with cases that fall through.
function classify(value: number | string | null): string {
  switch (value) {
    case 0:
    case 1:
      return "small";
    case 2:
      value = 3;
    case 3: {
      const inner = "three";
      return inner + value;
    }
    case "text":
      return "string";
    case null:
      return "null";
    default:
      break;
  }
  switch (typeof value) {
    case "number":
      return value > 100 ? "big" : "medium";
    default:
      return "other";
  }
}
console.log([0, 1, 2, 3, "text", null, 50, 500, "x"].map(classify));
function dynamic(x: number, y: number): string {
  switch (true) {
    case x > y:
      return "greater";
    case x === y:
      return "equal";
  }
  return "less";
}
console.log(dynamic(1, 2), dynamic(2, 2), dynamic(3, 2));
