// `inner/` turns `strictNullChecks` off and keeps the rest of `strict`, the program has all of it.
import { half, Point, Early } from "./inner/only-reported.ts";
console.log(half(4), half(-4), new Point().x, new Early().y);
