// `noImplicitAny` decides whether a function under a type with two call signatures gets one signature made of both. `inner/` is written with it, the program without it.
import { describe } from "./inner/handler.ts";
console.log(describe(1), describe("a"));
