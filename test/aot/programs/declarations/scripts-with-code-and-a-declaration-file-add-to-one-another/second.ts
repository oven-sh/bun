interface Shape {
  second: number;
}
(globalThis as any).measure = (value: Shape | Units.Meter) =>
  "meters" in value ? value.meters + " m" : value.declared + value.first + value.second;
const foot: Units.Foot = { feet: 3 };
console.log("second", foot.feet);
