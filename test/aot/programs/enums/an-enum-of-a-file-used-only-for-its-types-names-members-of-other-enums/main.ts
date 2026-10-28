// The members are made of members of another enum of the file, of an enum in a namespace of the file, and of an enum of a third file, which is used for its types alone too.
import { Sum } from "./sum";
function describe(sum: Sum): string {
  return "sum " + sum;
}
console.log(describe(1), describe(6), describe(24), describe(31));
