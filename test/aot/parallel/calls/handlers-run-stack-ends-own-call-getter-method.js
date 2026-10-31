// A function counts itself in, and inside a try it calls a function of the program that computes with many locals and calls nothing, and then itself. The handler counts it out.
// The frame of the function with the locals is the larger one, so that call is where the stack ends. Every frame that has counted itself in counts itself out: the error
// belongs to the try around the call, whatever kind of call it is: by name, a getter, a setter, a method, a closure, or a function that calls the one with the locals.
// Alone: where the stack ends depends on what else ran in the process, so no joined group takes this program
let open = 0;

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
function sumOfTwo(seed) {
  return sum(seed) + sum(seed + 1);
}
const holder = {
  seed: 0,
  kept: 0,
  get sum() {
    const seed = this.seed;
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
  },
  set next(seed) {
    this.kept = (() => {
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
    })();
  },
  add() {
    const seed = this.seed;
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
  },
};
class Holder {
  seed = 0;
  add() {
    const seed = this.seed;
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
}
const instance = new Holder();
const closure = (base => seed => {
  seed += base;
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
})(1);

const finallyAround = {
  "a call by name": function descend(level) {
    open++;
    try {
      return sum(level) + descend(level + 1);
    } finally {
      open--;
    }
  },
  "a getter": function descend(level) {
    open++;
    try {
      return ((holder.seed = level), holder.sum) + descend(level + 1);
    } finally {
      open--;
    }
  },
  "a setter": function descend(level) {
    open++;
    try {
      return ((holder.next = level), holder.kept) + descend(level + 1);
    } finally {
      open--;
    }
  },
  "a method": function descend(level) {
    open++;
    try {
      return ((holder.seed = level), holder.add()) + descend(level + 1);
    } finally {
      open--;
    }
  },
  "a method of a class": function descend(level) {
    open++;
    try {
      return ((instance.seed = level), instance.add()) + descend(level + 1);
    } finally {
      open--;
    }
  },
  "a closure": function descend(level) {
    open++;
    try {
      return closure(level) + descend(level + 1);
    } finally {
      open--;
    }
  },
  "a function that calls it": function descend(level) {
    open++;
    try {
      return sumOfTwo(level) + descend(level + 1);
    } finally {
      open--;
    }
  },
};

const catchAround = {
  "a call by name": function descend(level) {
    open++;
    let result;
    try {
      result = sum(level) + descend(level + 1);
    } catch (error) {
      open--;
      throw error;
    }
    open--;
    return result;
  },
  "a getter": function descend(level) {
    open++;
    let result;
    try {
      result = ((holder.seed = level), holder.sum) + descend(level + 1);
    } catch (error) {
      open--;
      throw error;
    }
    open--;
    return result;
  },
  "a method": function descend(level) {
    open++;
    let result;
    try {
      result = ((holder.seed = level), holder.add()) + descend(level + 1);
    } catch (error) {
      open--;
      throw error;
    }
    open--;
    return result;
  },
};

for (const [guard, table] of Object.entries({ finally: finallyAround, catch: catchAround })) {
  for (const [name, descend] of Object.entries(table)) {
    open = 0;
    let outcome;
    try {
      outcome = "answers " + descend(0);
    } catch (error) {
      outcome = error instanceof RangeError ? "RangeError" : String(error);
    }
    console.log(guard + " around " + name + ":", outcome, "| still open:", open);
  }
}
