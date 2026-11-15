import {
  Aliased, Assigned, Bracketed, Copied, Defined, Deleted, Destructured, Extended, Held, Keyed, Looped, Merged, OffNamespace, Passed,
  PassedOn, Renamed, Stepped, Untouched,
} from "./kinds";
import { kinds } from "./barrel";
function arm(value: unknown) {
  switch (value) {
    case Assigned.One:
      return "assigned";
    case Keyed.One:
      return "keyed";
    case Bracketed.One:
      return "bracketed";
    default:
      return "none";
  }
}
export function reads() {
  return [
    Assigned.One, Assigned["One"], Assigned.Two, Bracketed.One, Keyed.One, Stepped.One, Deleted.One, Destructured.One, Merged.One,
    Defined.One, Aliased.One, Passed.One, PassedOn.One, Looped.One, Renamed.One, OffNamespace.One, kinds.OffExportedNamespace.One,
    Extended.One, Untouched.One, Held.One, Copied.One, Copied.Two, arm(1), arm("far"), Assigned.One === (1 as any),
  ].map(String).join();
}
