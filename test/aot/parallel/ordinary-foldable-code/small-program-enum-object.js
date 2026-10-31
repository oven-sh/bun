const Color = { Red: "RED", Green: "GREEN", Blue: "BLUE" };
const HEX = { [Color.Red]: "#f00", [Color.Green]: "#0f0", [Color.Blue]: "#00f" };
const current = Color.Green;
switch (current) {
  case Color.Red:
    console.log("stop");
    break;
  case Color.Green:
    console.log("go", HEX[current]);
    break;
  default:
    console.log("?");
}
console.log(Object.values(Color).map((c) => c.toLowerCase()));
