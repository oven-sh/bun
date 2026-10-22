// `{ a: "x", b: 0, ...given, c: given.c ?? given.d ?? "y" }`: constants, then a spread of an object whose fields are all optional, then fields that are computed from it. In a loop, with four
// different objects. The compiler builds such a literal by a plan for its fields, and once died on it in the pass behind the one that sinks allocations.
type Frame = {
  wrap?: "none" | "lines" | "words";
  way?: "across" | "down";
  grow?: number;
  shrink?: number;
  gap?: number;
  inset?: number;
  clip?: "shown" | "cut";
  clipAcross?: "shown" | "cut";
  clipDown?: "shown" | "cut";
};
function complete(given: Frame): Frame {
  return {
    wrap: "none",
    way: "across",
    grow: 0,
    shrink: 1,
    ...given,
    clipAcross: given.clipAcross ?? given.clip ?? "shown",
    clipDown: given.clipDown ?? given.clip ?? "shown",
  };
}
const all: Frame[] = [{ gap: 1 }, { way: "down", inset: 2 }, { clip: "cut" }, {}];
let sum = 0;
for (let round = 0; round < 4000; round++) {
  const made = complete(all[round % all.length]!);
  sum += made.clipAcross!.length + made.way!.length + (made.gap ?? 0);
}
console.log(sum, JSON.stringify(complete({ clip: "cut", grow: 2 })), Object.keys(complete({})).join());
