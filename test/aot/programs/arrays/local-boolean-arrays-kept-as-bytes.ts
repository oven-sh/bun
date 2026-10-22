// IR= 1 paintedPosts CallBuiltin .* overload=Uint8Array/
// IR= 0 paintedPosts overload=ArrayPrototypeFill/
// IR= 1 bornTrue CallBuiltin .* overload=Uint8Array/
// IR= 1 askedForItsLength CallBuiltin .* overload=Uint8Array/
// IR= 1 ofAConstantLength CallBuiltin .* overload=Uint8Array/
// IR= 2 storesWhatATestSays CallBuiltin .* overload=Uint8Array/
// IR= 2 twoAtOnce CallBuiltin .* overload=Uint8Array/
// IR= 1 bornInALoop CallBuiltin .* overload=Uint8Array/
// IR= 0 isReturned CallBuiltin .* overload=Uint8Array/
// IR= 0 isPassedOn CallBuiltin .* overload=Uint8Array/
// IR= 0 isCaptured CallBuiltin .* overload=Uint8Array/
// IR= 0 keyOutOfData CallBuiltin .* overload=Uint8Array/
// IR= 0 storesPastTheEnd CallBuiltin .* overload=Uint8Array/
// IR= 0 mayReadBelowZero CallBuiltin .* overload=Uint8Array/
// IR= 0 fractionalSteps CallBuiltin .* overload=Uint8Array/
// IR= 0 isNeverFilled CallBuiltin .* overload=Uint8Array/
// IR= 0 holdsOtherThings CallBuiltin .* overload=Uint8Array/
// IR= 0 isMadeShorter CallBuiltin .* overload=Uint8Array/
function paintedPosts(lastPost: number): string {
  const painted = new Array<boolean>(1 + lastPost).fill(false);
  for (let painter = 1; painter <= lastPost; painter++) {
    for (let post = painter * painter; post <= lastPost; post += painter + painter) painted[post] = true;
  }
  let bare = 0;
  let sumOfBare = 0;
  for (let post = 0; post <= lastPost; post++) {
    if (painted[post]) continue;
    bare++;
    sumOfBare += post;
  }
  return bare + ":" + sumOfBare;
}
function bornTrue(size: number): string {
  const open = new Array<boolean>(size).fill(true);
  for (let i = 0; i < size; i += 3) open[i] = false;
  let said = "";
  for (let i = 0; i < size; i++) said += open[i] ? "o" : ".";
  for (let i = 1; i < size; i += 4) open[i] = true;
  let count = 0;
  for (let i = 0; i < size; i++) if (open[i] === true) count++;
  return said + count;
}
function askedForItsLength(size: number): string {
  const marks = Array<boolean>(size).fill(false);
  for (let i = 0; i < marks.length; i += 2) marks[i] = true;
  let on = 0;
  for (let i = 0; i < marks.length; i++) if (marks[i]) on++;
  return on + " of " + marks.length;
}
function ofAConstantLength(seed: number): string {
  const seen = new Array<boolean>(10).fill(false);
  let digits = 0;
  for (let rest = seed; rest > 0; rest = Math.floor(rest / 10)) {
    const digit = rest % 10 | 0;
    if (digit >= 0 && digit < 10) {
      if (!seen[digit]) digits++;
      seen[digit] = true;
    }
  }
  return digits + " " + seen[0] + " " + seen[9];
}
function storesWhatATestSays(size: number): string {
  const even = new Array<boolean>(size).fill(false);
  const notEven = new Array<boolean>(size).fill(true);
  for (let i = 0; i < size; i++) {
    even[i] = i % 2 === 0;
    notEven[i] = i % 2 !== 0;
  }
  const kept: unknown[] = [];
  for (let i = 0; i < size; i++) kept.push(even[i], notEven[i]);
  return JSON.stringify(kept);
}
function twoAtOnce(size: number): number {
  const rows = new Array<boolean>(size).fill(false), columns = new Array<boolean>(size + 1).fill(false);
  for (let i = 0; i < size; i += 2) rows[i] = true;
  for (let i = 0; i <= size; i += 3) columns[i] = true;
  let both = 0;
  for (let i = 0; i < size; i++) if (rows[i] && columns[i]) both++;
  return both;
}
function bornInALoop(greatestSize: number): string {
  let said = "";
  for (let size = 0; size <= greatestSize; size += 3) {
    const flags = new Array<boolean>(size).fill(false);
    for (let i = 1; i < size; i += 2) flags[i] = true;
    let on = 0;
    for (let i = 0; i < size; i++) if (flags[i]) on++;
    said += on + "/" + size + " ";
  }
  return said;
}

function isReturned(size: number): boolean[] {
  const made = new Array<boolean>(size).fill(false);
  for (let i = 0; i < size; i += 2) made[i] = true;
  return made;
}
function describe(list: boolean[]): string {
  return Array.isArray(list) + " " + list.join("");
}
function isPassedOn(size: number): string {
  const made = new Array<boolean>(size).fill(false);
  for (let i = 0; i < size; i += 2) made[i] = true;
  return describe(made);
}
function isCaptured(size: number): () => number {
  const made = new Array<boolean>(size).fill(true);
  for (let i = 0; i < size; i += 2) made[i] = false;
  return () => made.filter(Boolean).length;
}
const keysOutOfData = [1, 3, 9, -2, 1.5];
function keyOutOfData(size: number): string {
  const keys = keysOutOfData;
  const hit = new Array<boolean>(size).fill(false);
  for (const key of keys) hit[key] = true;
  let said = "";
  for (const key of keys) said += hit[key] + ",";
  return said + hit.length + Object.keys(hit).length;
}
function storesPastTheEnd(size: number): string {
  const grows = new Array<boolean>(size).fill(false);
  for (let i = 0; i <= size; i++) grows[i] = true;
  return grows.length + " " + grows[size];
}
function mayReadBelowZero(size: number): string {
  const flags = new Array<boolean>(size).fill(true);
  let said = "";
  for (let i = size - 1; i < size && said.length < 40; i -= 2) said += flags[i] + " ";
  return said;
}
function fractionalSteps(size: number): string {
  const flags = new Array<boolean>(size).fill(false);
  for (let x = 0; x < size; x += 0.5) flags[x] = true;
  return flags.length + " " + Object.keys(flags).join();
}
function isNeverFilled(size: number): string {
  const holes = new Array<boolean>(size);
  for (let i = 0; i < size; i += 2) holes[i] = true;
  let said = "";
  for (let i = 0; i < size; i++) said += holes[i] + " ";
  return said;
}
function holdsOtherThings(size: number): string {
  const mixed: unknown[] = new Array<unknown>(size).fill(false);
  for (let i = 0; i < size; i += 2) mixed[i] = i;
  let said = "";
  for (let i = 0; i < size; i++) said += mixed[i] + " ";
  return said;
}
function isMadeShorter(size: number): string {
  const flags = new Array<boolean>(size).fill(true);
  flags.length = 1;
  let said = "";
  for (let i = 0; i < size; i++) said += flags[i] + " ";
  return said;
}
function outcome(run: () => unknown): string {
  let said: string;
  try {
    said = String(run());
  } catch (error) {
    said = (error as Error).constructor.name + ": " + (error as Error).message;
  }
  return said;
}
function withOddSizes(run: (size: number) => unknown): string {
  return [
    outcome(() => run(-1)),
    outcome(() => run(-2)),
    outcome(() => run(1.5)),
    outcome(() => run(NaN)),
    outcome(() => run(Infinity)),
    outcome(() => run(4294967296)),
    outcome(() => run(-0)),
  ].join(", ");
}

for (let round = 0; round < 2; round++) {
  console.log(paintedPosts(50), paintedPosts(2), paintedPosts(0), paintedPosts(-1), paintedPosts(1000));
  console.log(bornTrue(11), bornTrue(1), bornTrue(0), "|", askedForItsLength(7), askedForItsLength(1), "|", ofAConstantLength(9024409), ofAConstantLength(0));
  console.log(storesWhatATestSays(5), twoAtOnce(20), twoAtOnce(0), bornInALoop(10), bornInALoop(0), bornInALoop(-1));
  console.log(describe(isReturned(5)), isPassedOn(4), isCaptured(7)(), keyOutOfData(4), storesPastTheEnd(3), "|", mayReadBelowZero(5));
  console.log(fractionalSteps(3), "|", isNeverFilled(4), "|", holdsOtherThings(4), "|", isMadeShorter(3));
  console.log(describe(isReturned(0)), isPassedOn(1), isCaptured(2)(), keyOutOfData(1), storesPastTheEnd(0), "|", mayReadBelowZero(1), "|", fractionalSteps(1), "|", isNeverFilled(1), "|", holdsOtherThings(1), "|", isMadeShorter(1));
  console.log(withOddSizes(bornTrue), "|", withOddSizes(paintedPosts), "|", withOddSizes(askedForItsLength));
}
const leftAsWritten: ((size: number) => unknown)[] = [isReturned, isPassedOn, isCaptured, keyOutOfData, storesPastTheEnd, mayReadBelowZero, fractionalSteps, isNeverFilled, holdsOtherThings, isMadeShorter];
for (const run of leftAsWritten) {
  const answer = run(6);
  console.log(typeof answer === "function" ? answer() : String(answer));
}
const keptAsBytes: ((size: number) => unknown)[] = [paintedPosts, bornTrue, askedForItsLength, ofAConstantLength, storesWhatATestSays, twoAtOnce, bornInALoop];
for (const run of keptAsBytes) console.log(String(run(6)), String(run(13)));
