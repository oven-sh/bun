enum Color {
  Red,
  Green,
  Blue,
}
function f() {
  return Color.Blue + 1;
}
console.log(Color.Green, f(), Color.Red === 0 ? "zero" : "no");
