// Env: BUN_JSC_markedBlockCageSizeInMB=64
// Under: --aot-testing=CheckProofsAtRunTime --aot-check=Validate: the cell that an allocation hands on is looked at
class Plain {
  id: number;
  note: { name: string } | undefined;
  next: Plain | null;
  constructor(id: number) {
    this.id = id;
    this.note = undefined;
    this.next = null;
  }
}
class Noted extends Plain {
  mark: number;
  constructor(id: number, note: { name: string }) {
    super(id);
    this.note = note;
    this.mark = id + 1;
  }
}
const notes = [{ name: "x" }, { name: "y" }, { name: "z" }];
let oldest: Plain = new Plain(0);
let newest: Plain = oldest;
function push() {
  const id = newest.id + 1;
  const made = id % 2 ? new Noted(id, notes[id % 3]) : new Plain(id);
  newest.next = made;
  newest = made;
}
function grow(count: number) {
  for (let i = 0; i < count; i++) push();
}
function turn(count: number) {
  for (let i = 0; i < count; i++) {
    push();
    oldest = oldest.next!;
  }
}
function isFull(run: (count: number) => void, count: number): boolean {
  try {
    run(count);
    return false;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return true;
  }
}
function wrong(): number {
  let count = 0;
  for (let made: Plain | null = oldest; made; made = made.next) {
    if (made instanceof Noted ? made.note !== notes[made.id % 3] || made.mark !== made.id + 1 : made.note !== undefined) count++;
  }
  return count;
}
isFull(grow, 1_200_000);
let total = wrong();
for (let cycle = 0; cycle < 40; cycle++) {
  if (isFull(turn, 50_000)) {
    for (let i = 0; i < 1000; i++) oldest = oldest.next!;
  }
  if (cycle % 8 === 7) total += wrong();
}
console.log("wrong", total + wrong());
