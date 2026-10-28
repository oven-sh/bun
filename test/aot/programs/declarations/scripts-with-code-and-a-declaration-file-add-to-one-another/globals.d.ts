interface Shape {
  declared: number;
}
declare namespace Units {
  interface Meter {
    meters: number;
  }
}
declare function measure(shape: Shape): number;
