// the bodies of three modules run one below the other, each calls small functions, and one overflows the stack and catches it
import { fromFirst } from "./first";
import { fromSecond } from "./second";
function small(v: number): number {
  return v * 2 + 1;
}
function deed() {
  return [small(1), fromFirst, fromSecond].join();
}
console.log(deed());
const later = await import("./later");
console.log(later.fromLater);
console.log(deed());
