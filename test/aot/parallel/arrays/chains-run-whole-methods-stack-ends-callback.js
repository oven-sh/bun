// A chain of array methods runs at every depth down to the end of the stack. One callback counts its calls, or throws at the last element. The other computes with many locals
// and calls nothing, so its frame is the larger one and its first call is where the stack ends. Whoever catches that error finds that the method in front has run for every
// element, and the method behind for none.
// Alone: where the stack ends depends on what else ran in the process, so no joined group takes this program
const list = [1, 2, 3];
let counted = 0;
let partly = 0;
let others = 0;

function sum(seed) {
  const p0 = (seed + 1) | 0, p1 = (seed + 2) | 0, p2 = (seed + 3) | 0, p3 = (seed + 4) | 0, p4 = (seed + 5) | 0, p5 = (seed + 6) | 0, p6 = (seed + 7) | 0, p7 = (seed + 8) | 0,
    p8 = (seed + 9) | 0, p9 = (seed + 10) | 0, p10 = (seed + 11) | 0, p11 = (seed + 12) | 0, p12 = (seed + 13) | 0, p13 = (seed + 14) | 0, p14 = (seed + 15) | 0, p15 = (seed + 16) | 0,
    p16 = (seed + 17) | 0, p17 = (seed + 18) | 0, p18 = (seed + 19) | 0, p19 = (seed + 20) | 0, p20 = (seed + 21) | 0, p21 = (seed + 22) | 0, p22 = (seed + 23) | 0, p23 = (seed + 24) | 0,
    p24 = (seed + 25) | 0, p25 = (seed + 26) | 0, p26 = (seed + 27) | 0, p27 = (seed + 28) | 0, p28 = (seed + 29) | 0, p29 = (seed + 30) | 0, p30 = (seed + 31) | 0, p31 = (seed + 32) | 0,
    p32 = (seed + 33) | 0, p33 = (seed + 34) | 0, p34 = (seed + 35) | 0, p35 = (seed + 36) | 0, p36 = (seed + 37) | 0, p37 = (seed + 38) | 0, p38 = (seed + 39) | 0, p39 = (seed + 40) | 0,
    p40 = (seed + 41) | 0, p41 = (seed + 42) | 0, p42 = (seed + 43) | 0, p43 = (seed + 44) | 0, p44 = (seed + 45) | 0, p45 = (seed + 46) | 0, p46 = (seed + 47) | 0, p47 = (seed + 48) | 0;
  return (
    p0 + p1 + p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9 + p10 + p11 + p12 + p13 + p14 + p15 +
    p16 + p17 + p18 + p19 + p20 + p21 + p22 + p23 + p24 + p25 + p26 + p27 + p28 + p29 + p30 + p31 +
    p32 + p33 + p34 + p35 + p36 + p37 + p38 + p39 + p40 + p41 + p42 + p43 + p44 + p45 + p46 + p47
  );
}
const counts = item => {
  counted++;
  return item;
};
const throwsAtTheLast = item => {
  if (item === 3) throw new TypeError("the last element");
  return item;
};

const chains = {
  "map that counts, filter that computes": () => list.map(counts).filter(item => sum(item) > 0).length,
  "map that counts, map that computes": () => list.map(counts).map(sum).length,
  "filter that counts, map that computes, reduce": () => list.filter(item => counts(item) > 0).map(sum).reduce((all, each) => all + each, 0),
  "map that computes, forEach that counts": () => list.map(sum).forEach(counts),
  "filter that computes, map that counts": () => list.filter(item => sum(item) > 0).map(counts).length,
  "map that throws at the last element, map that computes": () => list.map(throwsAtTheLast).map(sum).length,
};

for (const [name, chain] of Object.entries(chains)) {
  partly = 0;
  others = 0;
  const descend = level => {
    counted = 0;
    try {
      chain();
    } catch (error) {
      if (counted % list.length) partly++;
      if (error instanceof TypeError) return 1 + descend(level + 1);
      if (name.includes("throws")) others++;
      throw error;
    }
    return 1 + descend(level + 1);
  };
  let outcome;
  try {
    outcome = "answers " + descend(0);
  } catch (error) {
    outcome = error instanceof RangeError ? "RangeError" : String(error);
  }
  console.log(name + ":", outcome, "| a method caught halfway:", partly, "| another error than the first method's:", others > 1 ? "more than once" : "at most once");
}
