import * as all from "./color";
import { read } from "./reader";
const spoil = (it: any) => {
  it.Color.Green = 9;
};
console.log(read());
spoil(all);
console.log(read());
