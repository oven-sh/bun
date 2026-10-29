import { Length } from "./lengths";
import * as lengths from "./lengths";

console.log(Length.Plain, Length.OneMore, Length.InBrackets, Length.OfJoinedTexts);
console.log(Length.OfTemplate, Length.InChain, Length.OfNothing, Length.OneMoreThanNothing);
console.log(lengths.Length.Plain + lengths.Length["OneMore"], Length.Plain === 3 ? "three" : "other");

enum Local {
  A = "local".length,
  B = A * 2,
}
console.log(Local.A, Local.B, Local[5], Local[10]);
console.log(
  typeof "abc".length,
  "abc".length.toFixed(1),
  "".length || "empty",
  ("a" + "\ud83d").length + "\ude00".length,
);
console.log(("\ud83d" + "\ude00").length, (1 as any).length, "abc".length === 3 ? "three" : "other");
