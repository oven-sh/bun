// A union of object types that have only the discriminant in common.
import type { All, I1, I3, I5, I8 } from "./files/nodes";
import { byChain, byGuard, deepSingle, parsed, single } from "./files/guards";
const one: I1 = { kind: "k1", own1: 1 };
const three: I3 = { kind: "k3", own3: 3 };
const five: I5 = { kind: "k5", own5: 5 };
const eight: I8 = { kind: "k8", own8: 8 };
const all: All[] = [one, three, five, eight];
console.log(all.map(byGuard).join(), all.map(byChain).join(), single(three), deepSingle(three), parsed());
