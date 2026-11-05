// An exported enum as TypeScript emits it, since 3.9 and up to 3.8: the store stands on the right of `||`, every run of the body leaves the name there, and nothing stores it behind the body.
// STATISTIC: Faces = 0
// STATISTIC: ModulesWithNames >= 2
import { Color, f } from "./since-3-9.cjs";
import { Shade, g } from "./up-to-3-8.cjs";
console.log(Color.Red, Color[1], f(), Shade.Dark, Shade[1], g());
