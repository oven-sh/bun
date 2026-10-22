// An object made as one record type gets the members of a larger one through `any` and is passed as that type. It has every member, so it is taken as it is: the same object, and a store through the parameter is seen through the first reference.
function row(name: string, run: () => unknown): void {
  try {
    console.log(name + ": " + String(run()));
  } catch (error) {
    console.log(name + ": " + (error instanceof Error ? error.name : String(error)));
  }
}
function hide(value: unknown): any {
  return value;
}

interface Inner {
  value: number;
}
interface Point {
  inner: Inner;
  x: number;
  y: number;
}
interface Link0 {
  entries: Map<string, number>;
  next: Link1 | null;
}
interface Link1 {
  entries: Map<string, number>;
  next: Link2 | null;
}
interface Link2 {
  entries: Map<string, number>;
  next: Link3 | null;
}
interface Link3 {
  entries: Map<string, number>;
  next: Link4 | null;
}
interface Link4 {
  entries: Map<string, number>;
  next: Link5 | null;
}
interface Link5 {
  entries: Map<string, number>;
  next: Link6 | null;
}
interface Link6 {
  entries: Map<string, number>;
  next: Link7 | null;
}
interface Link7 {
  entries: Map<string, number>;
  next: Link8 | null;
}
interface Link8 {
  entries: Map<string, number>;
  next: Link9 | null;
}
interface Link9 {
  entries: Map<string, number>;
  next: Link10 | null;
}
interface Link10 {
  entries: Map<string, number>;
  next: Link11 | null;
}
interface Link11 {
  entries: Map<string, number>;
  next: Link12 | null;
}
interface Link12 {
  entries: Map<string, number>;
  next: Link13 | null;
}
interface Link13 {
  entries: Map<string, number>;
  next: Link14 | null;
}
interface Link14 {
  entries: Map<string, number>;
  next: Link15 | null;
}
interface Link15 {
  entries: Map<string, number>;
  next: Link16 | null;
}
interface Link16 {
  entries: Map<string, number>;
  next: Link17 | null;
}
interface Link17 {
  entries: Map<string, number>;
  next: Link18 | null;
}
interface Link18 {
  entries: Map<string, number>;
  next: Link19 | null;
}
interface Link19 {
  entries: Map<string, number>;
  next: Link20 | null;
}
interface Link20 {
  entries: Map<string, number>;
  next: Link21 | null;
}
interface Link21 {
  entries: Map<string, number>;
  next: Link22 | null;
}
interface Link22 {
  entries: Map<string, number>;
  next: Link23 | null;
}
interface Link23 {
  entries: Map<string, number>;
  next: Link24 | null;
}
interface Link24 {
  entries: Map<string, number>;
  next: Link25 | null;
}
interface Link25 {
  entries: Map<string, number>;
  next: Link26 | null;
}
interface Link26 {
  entries: Map<string, number>;
  next: Link27 | null;
}
interface Link27 {
  entries: Map<string, number>;
  next: Link28 | null;
}
interface Link28 {
  entries: Map<string, number>;
  next: Link29 | null;
}
interface Link29 {
  entries: Map<string, number>;
  next: Link30 | null;
}
interface Link30 {
  entries: Map<string, number>;
  next: Link31 | null;
}
interface Link31 {
  entries: Map<string, number>;
  next: Link32 | null;
}
interface Link32 {
  entries: Map<string, number>;
  next: Link33 | null;
}
interface Link33 {
  entries: Map<string, number>;
  next: Link34 | null;
}
interface Link34 {
  entries: Map<string, number>;
  next: Link35 | null;
}
interface Link35 {
  entries: Map<string, number>;
  next: Link36 | null;
}
interface Link36 {
  entries: Map<string, number>;
  next: Link37 | null;
}
interface Link37 {
  entries: Map<string, number>;
  next: Link38 | null;
}
interface Link38 {
  entries: Map<string, number>;
  next: Link39 | null;
}
interface Link39 {
  entries: Map<string, number>;
  next: Link0 | null;
}
interface Labeled {
  inner: Inner;
  x: number;
  label: string;
  entries: Map<string, number>;
  chain: Link0 | null;
}

let seen: unknown = null;
function moved(point: Point): number {
  point.x += 1;
  return point.inner.value + point.x + point.y;
}
function described(labeled: Labeled): string {
  seen = labeled;
  labeled.x += 1;
  return labeled.label + labeled.x + labeled.entries.size;
}
function pointGivenTheOtherMembers(): any {
  const point: Point = { inner: { value: 1 }, x: 1.5, y: 2.5 };
  moved(point);
  const object = hide(point);
  object.label = "n";
  object.entries = new Map([["a", 1]]);
  object.chain = null;
  return object;
}

const link0: Link0 = { entries: new Map(), next: null };
const link1: Link1 = { entries: new Map(), next: null };
const link2: Link2 = { entries: new Map(), next: null };
const link3: Link3 = { entries: new Map(), next: null };
const link4: Link4 = { entries: new Map(), next: null };
const link5: Link5 = { entries: new Map(), next: null };
const link6: Link6 = { entries: new Map(), next: null };
const link7: Link7 = { entries: new Map(), next: null };
const link8: Link8 = { entries: new Map(), next: null };
const link9: Link9 = { entries: new Map(), next: null };
const link10: Link10 = { entries: new Map(), next: null };
const link11: Link11 = { entries: new Map(), next: null };
const link12: Link12 = { entries: new Map(), next: null };
const link13: Link13 = { entries: new Map(), next: null };
const link14: Link14 = { entries: new Map(), next: null };
const link15: Link15 = { entries: new Map(), next: null };
const link16: Link16 = { entries: new Map(), next: null };
const link17: Link17 = { entries: new Map(), next: null };
const link18: Link18 = { entries: new Map(), next: null };
const link19: Link19 = { entries: new Map(), next: null };
const link20: Link20 = { entries: new Map(), next: null };
const link21: Link21 = { entries: new Map(), next: null };
const link22: Link22 = { entries: new Map(), next: null };
const link23: Link23 = { entries: new Map(), next: null };
const link24: Link24 = { entries: new Map(), next: null };
const link25: Link25 = { entries: new Map(), next: null };
const link26: Link26 = { entries: new Map(), next: null };
const link27: Link27 = { entries: new Map(), next: null };
const link28: Link28 = { entries: new Map(), next: null };
const link29: Link29 = { entries: new Map(), next: null };
const link30: Link30 = { entries: new Map(), next: null };
const link31: Link31 = { entries: new Map(), next: null };
const link32: Link32 = { entries: new Map(), next: null };
const link33: Link33 = { entries: new Map(), next: null };
const link34: Link34 = { entries: new Map(), next: null };
const link35: Link35 = { entries: new Map(), next: null };
const link36: Link36 = { entries: new Map(), next: null };
const link37: Link37 = { entries: new Map(), next: null };
const link38: Link38 = { entries: new Map(), next: null };
const link39: Link39 = { entries: new Map(), next: null };
const links = [link0, link1, link2, link3, link4, link5, link6, link7, link8, link9, link10, link11, link12, link13, link14, link15, link16, link17, link18, link19, link20, link21, link22, link23, link24, link25, link26, link27, link28, link29, link30, link31, link32, link33, link34, link35, link36, link37, link38, link39];
const labeled: Labeled = { inner: { value: 1 }, x: 1, label: "t", entries: new Map(), chain: link0 };
row("created as the type", () => described(labeled) + ":" + links.length);
row("as an argument", () => {
  const object = pointGivenTheOtherMembers();
  const text = described(object);
  return text + " " + (object === seen) + " " + object.x;
});
