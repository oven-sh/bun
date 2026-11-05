// A typed record has a member of unknown type, which holds a list of a record that holds a list that holds that record again. JSON.stringify is given a list that holds the typed record twice,
// and then, three times, a record with a getter. Each call prints its answer or the name of its error.
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
const ring: Record<string, unknown[]> = { first: [], second: [] };
const typed = holder("typed");
const withGetter = {
  id: 4,
  get read() {
    return 1;
  },
};
typed.any = withGetter;
ring.first.push(ring);
typed.any = [ring];
function write(name: string, make: () => string | undefined) {
  try {
    console.log(name, make());
  } catch (error) {
    console.log("threw " + (error as Error).name);
  }
}
write("typed", () => JSON.stringify([typed, typed]));
for (let turn = 0; turn < 3; turn++) write("getter, turn " + turn, () => JSON.stringify({ top: withGetter }, null, 1));
