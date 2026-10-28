// As a server does with each request and each response: fresh objects of some kinds are given prototypes of the program's own, over and over.
// The run time remembers what an object with one Structure becomes under one prototype. Two kinds that share a place in that memory throw each other out at every turn,
// and each of them then asks the run time at every turn.
// ONE OF ITS BUDGETS WAS RAISED, ONCE: the calls into the run time, from 4,831 to 11,441 (0.005 a turn). The compiler used to guess, for an object that Object.setPrototypeOf had just been called on,
// that it still had the prototype of its layout: a test that failed at every turn. Without that test the method is looked up by name in the loop itself, and the cache of that place meets 24 layouts.
// The same change took the instructions from 494 to 358 million, the failed tests from 2,400,000 to none and the accesses by name to half: a stand-in may move where what it stands for falls.
const kinds = 24
const prototypes = Array.from({ length: kinds }, (_, kind) => ({ kindOf() { return kind } }))
function make(kind: number, turn: number): object {
  switch (kind) {
    case 0: return { f0_0: turn }
    case 1: return { f1_0: turn, f1_1: 1 }
    case 2: return { f2_0: turn, f2_1: 1, f2_2: 2 }
    case 3: return { f3_0: turn, f3_1: 1, f3_2: 2, f3_3: 3 }
    case 4: return { f4_0: turn, f4_1: 1, f4_2: 2, f4_3: 3, f4_4: 4 }
    case 5: return { f5_0: turn }
    case 6: return { f6_0: turn, f6_1: 1 }
    case 7: return { f7_0: turn, f7_1: 1, f7_2: 2 }
    case 8: return { f8_0: turn, f8_1: 1, f8_2: 2, f8_3: 3 }
    case 9: return { f9_0: turn, f9_1: 1, f9_2: 2, f9_3: 3, f9_4: 4 }
    case 10: return { f10_0: turn }
    case 11: return { f11_0: turn, f11_1: 1 }
    case 12: return { f12_0: turn, f12_1: 1, f12_2: 2 }
    case 13: return { f13_0: turn, f13_1: 1, f13_2: 2, f13_3: 3 }
    case 14: return { f14_0: turn, f14_1: 1, f14_2: 2, f14_3: 3, f14_4: 4 }
    case 15: return { f15_0: turn }
    case 16: return { f16_0: turn, f16_1: 1 }
    case 17: return { f17_0: turn, f17_1: 1, f17_2: 2 }
    case 18: return { f18_0: turn, f18_1: 1, f18_2: 2, f18_3: 3 }
    case 19: return { f19_0: turn, f19_1: 1, f19_2: 2, f19_3: 3, f19_4: 4 }
    case 20: return { f20_0: turn }
    case 21: return { f21_0: turn, f21_1: 1 }
    case 22: return { f22_0: turn, f22_1: 1, f22_2: 2 }
    default: return { last: turn }
  }
}
let sum = 0
const turns = Number((globalThis as any).N ?? 100000)
for (let turn = 0; turn < turns; turn++) {
  for (let kind = 0; kind < kinds; kind++) {
    const object = Object.setPrototypeOf(make(kind, turn), prototypes[kind]!) as { kindOf(): number }
    sum += object.kindOf()
  }
}
console.log("prototypes", sum)
