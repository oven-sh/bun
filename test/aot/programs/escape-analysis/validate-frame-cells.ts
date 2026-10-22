// Closures and environments that stay in the frame pass validation: poisoned at every exit, never retained, never used after it.
function sumWithClosure(n: number): number {
  let total = 0;
  function add(k: number): void {
    if (k <= 0) return;
    total += k;
    add(k - 1);
  }
  add(n);
  return total;
}

function perIteration(n: number): string {
  let text = "";
  for (let i = 0; i < n; i++) {
    let tag = "t" + i;
    const extend = function extend(k: number): void {
      if (k <= 0) return;
      tag += k;
      extend(k - 1);
    };
    extend(2);
    text += tag + ";";
  }
  return text;
}

function earlyReturn(n: number): number {
  if (n < 0) return -1;
  let count = 0;
  function bump(k: number): void {
    if (k > 0) {
      count++;
      bump(k - 1);
    }
  }
  if (n === 0) return count;
  bump(n);
  if (count > 3) return count * 2;
  bump(1);
  return count;
}

function throwsToCaller(n: number): number {
  let depth = 0;
  function descend(k: number): void {
    depth++;
    if (k === 0) throw new Error("bottom " + depth);
    descend(k - 1);
  }
  descend(n);
  return depth;
}

function catchesFromCallee(n: number): string {
  try {
    return "returned " + throwsToCaller(n);
  } catch (error) {
    return (error as Error).message;
  }
}

function catchesInFrame(n: number): string {
  let trail = "";
  function step(k: number): void {
    trail += k;
    if (k === 0) throw new Error("end");
    step(k - 1);
  }
  try {
    step(n);
  } catch (error) {
    trail += (error as Error).message;
  }
  return trail;
}

function tailPosition(n: number): number {
  let seen = 0;
  function visit(k: number): number {
    seen += k;
    return k > 0 ? visit(k - 1) : seen;
  }
  return visit(n);
}

function reentered(depth: number): number {
  let own = depth;
  function down(k: number): void {
    if (k > 0) {
      own += k;
      down(k - 1);
      return;
    }
    if (depth > 0) own += reentered(depth - 1);
  }
  down(2);
  return own;
}

for (let round = 0; round < 3; round++) {
  console.log(sumWithClosure(10 + round));
  console.log(perIteration(round + 1));
  console.log(earlyReturn(round - 1), earlyReturn(round + 3));
  console.log(catchesFromCallee(round));
  console.log(catchesInFrame(round + 1));
  console.log(tailPosition(round + 4));
  console.log(reentered(round + 1));
}
