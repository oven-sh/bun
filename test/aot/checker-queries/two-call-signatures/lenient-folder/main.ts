// `noImplicitAny` decides whether a function under a type with two call signatures gets one signature made of both. `inner/` is written without it, the program with it.
import { describe } from "./inner/handler.ts";
console.log(describe(1));
