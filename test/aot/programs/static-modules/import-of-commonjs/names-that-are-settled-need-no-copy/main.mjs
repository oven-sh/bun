// Names that a CommonJS file stores once, at its top, and that nobody stores again: a copy and a live read cannot be told apart.
// STATISTIC: Faces = 0
// STATISTIC: ModulesWithNames >= 1
import { one, g } from "./k.cjs";
console.log(one, g(5));
