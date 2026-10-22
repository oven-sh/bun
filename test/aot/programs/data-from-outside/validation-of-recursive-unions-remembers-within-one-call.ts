// A union that contains itself and whose arms no constant tells apart: one validation remembers what it found out about an object; the next one knows nothing of it.
import { validate } from "bun:bundle";
import type { Schema } from "bun";

type Tree = { below: Tree | null; k: number } | { below: Tree | null; k: string };
type Filled = { below: Filled | null; k: number; size: number & Schema.Default<7> } | { below: Filled | null; k: string; size: number & Schema.Default<9> };
type Lists = [Lists | null, 1] | [Lists | null, 2] | (Lists | "end")[];
type Partly = { kind: "a"; below: Partly | null } | { kind: "b"; below: Partly | null } | { below: Partly | null; other: number };
type Pair = { left: Tree; right: Tree; both: Tree[] };

function nest(levels: number, bottom: unknown, k: unknown): any {
  let made: any = bottom;
  for (let i = 0; i < levels; i++) made = { below: made, k };
  return made;
}

function outcome(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error: any) {
    return error.name;
  }
}

const mended = nest(6, null, "s");
console.log(outcome(() => validate<Tree>(mended)));
mended.below.below.below.k = true;
console.log(outcome(() => validate<Tree>(mended)));
mended.below.below.below.k = 3;
console.log(outcome(() => validate<Tree>(mended)));
mended.below.below.below.below.below.below = [];
console.log(outcome(() => validate<Tree>(mended)));
mended.below.below.below.below.below.below = null;
console.log(outcome(() => validate<Tree>(mended)));

const given = nest(5, null, "s");
let copy: any = validate<Tree>(given);
let original: any = given;
let distinct = 0;
while (copy !== null) {
  if (copy !== original) distinct++;
  copy = copy.below;
  original = original.below;
}
console.log(distinct, original);

const inner = nest(4, null, "s");
let within = "";
const asking = nest(3, { get below() { within = outcome(() => validate<Tree>(inner)); return inner; }, k: "s" }, "s");
console.log(outcome(() => validate<Tree>(asking)));
console.log(within);

inner.below.k = null;
console.log(outcome(() => validate<Tree>(asking)));
console.log(within);
inner.below.k = 1;

const throwing = nest(3, { get below(): never { throw new RangeError("not today"); }, k: "s" }, "s");
console.log(outcome(() => validate<Tree>(throwing)));
console.log(outcome(() => validate<Tree>(asking)));

const shared = nest(3, null, "s");
console.log(outcome(() => validate<Pair>({ left: shared, right: shared, both: [shared, shared.below, shared] })));
shared.below.below.k = false;
console.log(outcome(() => validate<Pair>({ left: shared, right: shared, both: [shared, shared.below, shared] })));

console.log(outcome(() => validate<Filled>(nest(4, null, "s"))));
console.log(outcome(() => validate<Filled>(nest(4, null, 1))));
console.log(outcome(() => JSON.parse<Filled>(JSON.stringify(nest(4, null, "s")))));
console.log(outcome(() => JSON.parse<Filled>(JSON.stringify(nest(4, { below: null, k: 1, size: 2 }, "s")))));
console.log(outcome(() => JSON.parse<Filled>(JSON.stringify(nest(4, { below: null, k: 1, size: "2" }, "s")))));

console.log(outcome(() => JSON.parse<Tree>(JSON.stringify(nest(4, null, "s")), (key, value) => (key === "k" ? 5 : value))));
console.log(outcome(() => JSON.parse<Tree>(JSON.stringify(nest(4, null, "s")), (key, value) => (key === "k" ? null : value))));

for (const text of ['[[[null,2],2],2]', '[[[null,2],1],"end"]', '[[[null,3],1],2]', '[[["end",[null,1]],2],[null,2],"end"]', '[[[null,2],2],{}]']) {
  console.log(outcome(() => JSON.parse<Lists>(text)), outcome(() => validate<Lists>(JSON.parse(text))));
}

for (const text of [
  '{"kind":"a","below":{"kind":"b","below":{"below":null,"other":1}}}',
  '{"kind":"c","below":{"kind":"b","below":null},"other":1}',
  '{"kind":"a","below":{"kind":"c","below":null}}',
  '{"kind":"a","below":{"kind":"b","below":{"below":{"below":{"below":7,"other":1},"other":1},"other":1}},"other":2}',
]) {
  console.log(outcome(() => JSON.parse<Partly>(text)), outcome(() => validate<Partly>(JSON.parse(text))));
}
