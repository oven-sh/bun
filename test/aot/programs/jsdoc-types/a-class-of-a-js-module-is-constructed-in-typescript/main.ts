import { Old } from "./library.js";

const made: new (value: number) => object = Old;
console.log(new Old(3).value, new Old(3).extra(), typeof made);
