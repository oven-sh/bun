// A package under its own tsconfig.json is checked with its own module options, not with those of the program.
import { area } from "./inner/index.ts";
console.log(area({ width: 2, height: 3 }));
