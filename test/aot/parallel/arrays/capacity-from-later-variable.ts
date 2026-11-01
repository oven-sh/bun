// Flags: --aot-verify-each-pass
// STATISTIC: ArrayCapacitiesPlanned >= 5
// A list begins with one element, and a loop pushes as many more as another list holds. That list lies in a variable, which the loop's test reads behind the literal.
// Nothing lies between the two, so the variable is read in front of the literal too and the list has room for all of them from the start.
const others: number[] = [4, 5, 6];
function byLength(i: number): number[] {
  const list: number[] = [i & 7];
  for (let k = 0; k < others.length; k++) list.push(others[k]);
  return list;
}
function byCounter(i: number): number[] {
  const list: number[] = [i & 7];
  for (let k = 0; k < others.length; k++) list.push(k);
  return list;
}
function byForOf(i: number): number[] {
  const list: number[] = [i & 7];
  for (const other of others) list.push(other);
  return list;
}
function overCaptured(): (i: number) => number[] {
  const inner: number[] = [7, 8, 9, 10];
  return i => {
    const list: number[] = [i & 7];
    for (let k = 0; k < inner.length; k++) list.push(inner[k]);
    return list;
  };
}
function overCapturedThatIsStoredTo(): { make: (i: number) => number[]; store: (list: number[]) => void } {
  let inner: number[] = [11, 12];
  return {
    make: function overStoredTo(i) {
      const list: number[] = [i & 7];
      for (let k = 0; k < inner.length; k++) list.push(inner[k]);
      return list;
    },
    store: list => {
      inner = list;
    },
  };
}

// What is walked is a Map or a Set in a variable: it is measured only where it stands in front of the literal.
let table: any = new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]);
const bag: Set<number> = new Set([5, 6, 7, 8]);
function keysOfTable(i: number): unknown[] {
  return [i & 7, ...table.keys()];
}
function spreadOfTable(i: number): unknown[] {
  const keys = [...table.keys()];
  keys.push(String(i & 7));
  return keys;
}
function overBag(i: number): number[] {
  const list: number[] = [i & 7];
  for (const member of bag) list.push(member);
  return list;
}

// The variable holds another list by the time the loop reads it.
let changing: number[] = [1];
function storesBetween(i: number): number[] {
  const list: number[] = [i & 7];
  changing = i & 1 ? [1, 2, 3, 4, 5] : [];
  for (let k = 0; k < changing.length; k++) list.push(changing[k]);
  return list;
}
function replace(i: number): void {
  changing = i & 1 ? [9] : [9, 8, 7, 6, 5, 4, 3, 2, 1];
}
function callsBetween(i: number): number[] {
  const list: number[] = [i & 7];
  replace(i);
  for (let k = 0; k < changing.length; k++) list.push(changing[k]);
  return list;
}

// The list that is measured grows, or shrinks, while the loop walks it.
const walked: number[] = [1, 2, 3];
function growsWhileWalked(i: number): number[] {
  walked.length = 3;
  const list: number[] = [i & 7];
  for (let k = 0; k < walked.length; k++) {
    if (walked.length < 6) walked.push(k + 10);
    list.push(walked[k]);
  }
  return list;
}
function shrinksWhileWalked(i: number): number[] {
  walked.length = 0;
  walked.push(1, 2, 3, 4, 5, 6);
  const list: number[] = [i & 7];
  for (let k = 0; k < walked.length; k++) {
    walked.pop();
    list.push(walked[k]);
  }
  return list;
}
function leavesEarly(i: number): number[] {
  const list: number[] = [i & 7];
  for (let k = 0; k < others.length; k++) {
    if (k > (i & 1)) break;
    list.push(others[k]);
  }
  return list;
}

const captured = overCaptured();
const storedTo = overCapturedThatIsStoredTo();
const alsoStoredTo = overCapturedThatIsStoredTo();
for (let i = 0; i < 4; i++) {
  storedTo.store(i & 1 ? [13, 14, 15] : [16]);
  if (i > 1) alsoStoredTo.store([17, 18, 19, 20, 21]);
  if (i > 2) table = new Map([["z", 26]]);
  for (const make of [byLength, byCounter, byForOf, captured, storedTo.make, alsoStoredTo.make, keysOfTable, spreadOfTable, overBag, storesBetween, callsBetween, growsWhileWalked, shrinksWhileWalked, leavesEarly]) {
    const list = make(i);
    list.push(-1);
    console.log(i, list.length, JSON.stringify(list));
  }
}
