import { First as Assigned, second as assigned } from "assigned";
import { First as Starred, second as starred } from "starred";
import { First as Computed, second as computed } from "computed";
import { First as Proven, second as proven } from "proven";
import { First as RequiredToo, second as requiredToo } from "required-too";
import { First as UsedByAnother, second as usedByAnother } from "used-by-another";
import { First as UsedHere, second as usedHere } from "used-here";
console.log("effects", new UsedHere().constructor.name, usedHere);
export function unused() {
  return [new Assigned(), assigned, new Starred(), starred, new Computed(), computed, new Proven(), proven, new RequiredToo(), requiredToo, new UsedByAnother(), usedByAnother];
}
