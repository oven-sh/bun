import { Color } from "./color";
class Box {
  [Color.Name] = Color.Green;
  static [Color.Green]() {
    return Color.Red;
  }
}
function pick(c: Color = Color.Green) {
  switch (c) {
    case Color.Red:
      return "red";
    case Color.Green:
      return "green";
    default:
      return `${Color.Name}!`;
  }
}
const { [Color.Name]: taken = Color.Green } = {} as Record<string, number>;
console.log(
  Color.Green.toFixed(1),
  Color.Name.length,
  Color.Name?.toUpperCase(),
  Color.Green?.toString(),
  typeof Color.Red,
  new Box().name,
  Box[1](),
  pick(),
  pick(Color.Name),
  taken,
  [Color.Red, ...[Color.Green]],
  { [Color.Name]: Color.Red },
  -Color.Green,
  !Color.Red,
  Color.Green satisfies Color,
  Color.Name!,
);
