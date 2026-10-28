import * as all from "./barrel";
import { read } from "./reader";
const spoil = (it: any) => {
  for (const key in it) it[key].Green = 9;
};
console.log(read());
spoil(all);
console.log(read());
