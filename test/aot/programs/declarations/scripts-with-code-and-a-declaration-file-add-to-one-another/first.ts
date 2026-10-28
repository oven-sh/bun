interface Shape {
  first: number;
}
declare namespace Units {
  interface Foot {
    feet: number;
  }
}
declare function measure(meter: Units.Meter): string;
const own: Shape = { declared: 1, first: 2, second: 3 };
console.log("first", own.declared + own.first + own.second);
