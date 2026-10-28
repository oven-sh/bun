// Records with a member of unknown type stand around rings in which a record holds a list that holds the record again. Each is written once, twice and three times in one list, alone, with a
// replacer and with an indent, and again with the ring taken out. Each call of JSON.stringify prints its answer or its error, and what ran before it, in order.
const log: string[] = [];
function counted(name: string, answer: unknown): object {
  return {
    toJSON() {
      log.push(name);
      return answer;
    },
  };
}
function write(name: string, make: () => string | undefined): void {
  try {
    console.log(name, make(), log.join());
  } catch (error) {
    console.log(name, "threw " + (error as Error).name, log.join());
  }
  log.length = 0;
}

interface Leaf {
  text: string;
  size: number;
}
interface Holder {
  name: string;
  self: Holder | null;
  leaf: Leaf;
  list: Holder[];
  any: unknown;
  maybe?: Holder;
}
const holder = (name: string): Holder => ({
  name,
  self: null,
  leaf: { text: name, size: name.length },
  list: [],
  any: undefined,
});

const ringOfLists: Record<string, unknown[]> = { first: [], second: [] };
ringOfLists.first.push(ringOfLists);
const behindUnknown = holder("behind unknown");
behindUnknown.any = [ringOfLists];

interface Branch {
  size: number;
  below: Branch[];
}
interface Crate {
  before: unknown;
  tree: Branch;
  after: unknown;
}
const ringOfBranches: Branch = { size: 1, below: [{ size: 2, below: [] }] };
ringOfBranches.below[0].below.push(ringOfBranches);
const straight: Branch = { size: 3, below: [{ size: 4, below: [] }] };
const crate: Crate = { before: counted("before", 1), tree: ringOfBranches, after: counted("after", 2) };
const shelf: { first: Crate; tree: Branch; last: unknown } = { first: crate, tree: straight, last: counted("last", 3) };

for (let turn = 0; turn < 3; turn++) {
  write("once", () => JSON.stringify([behindUnknown]));
  write("twice", () => JSON.stringify([behindUnknown, behindUnknown]));
  write("three times", () => JSON.stringify([behindUnknown, behindUnknown, behindUnknown]));
  write("crate", () => JSON.stringify(crate));
  write("crates", () => JSON.stringify([crate, crate]));
  write("shelf", () => JSON.stringify(shelf));
  write("replaced", () => JSON.stringify([crate, crate], (key, value) => (log.push("replacer " + key), value)));
  write("indented", () => JSON.stringify({ top: [shelf] }, null, 1));

  behindUnknown.any = counted("in place of the ring", turn);
  crate.tree = straight;
  write("twice, no ring", () => JSON.stringify([behindUnknown, behindUnknown]));
  write("crates, no ring", () => JSON.stringify([crate, crate]));
  write("shelf, no ring", () => JSON.stringify(shelf));
  behindUnknown.any = [ringOfLists];
  crate.tree = ringOfBranches;
}
