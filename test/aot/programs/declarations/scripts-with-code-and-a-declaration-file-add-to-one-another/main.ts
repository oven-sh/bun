/// <reference path="./globals.d.ts" />
import "./first";
import "./second";

const shape: Shape = { declared: 1, first: 2, second: 3 };
const meter: Units.Meter = { meters: 4 };
const foot: Units.Foot = { feet: 5 };
const sum: number = measure(shape);
const text: string = measure(meter);
console.log(sum, text, foot.feet);
