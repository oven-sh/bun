// A union of nine object types is read through the fields they have in common.
import type { All, I1, I7, I9, I20 } from "./files/nodes";
import { byCast, byChain, byGuard, byVariable, five, parsed, single } from "./files/guards";
const one: I1 = { kind: "k1", id: 1, name: "a", own1: 1 };
const seven: I7 = { kind: "k7", id: 7, name: "g", own7: 7 };
const nine: I9 = { kind: "k9", id: 9, name: "i", own9: 9 };
const twenty: I20 = { kind: "k20", id: 20, name: "t", own20: 20 };
const all: All[] = [one, seven, nine, twenty];
console.log(all.map(byGuard).join(), all.map(byChain).join(), byCast(nine), all.map(byVariable).join());
console.log(single(seven), five(one), parsed());
