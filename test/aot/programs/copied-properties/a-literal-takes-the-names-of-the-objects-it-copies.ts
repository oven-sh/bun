// A literal whose own type lists few names copies objects that hold many: what it copies is there under every name, in the order of the sources, whoever reads it and however.
type Wide = { id: number; title?: string; tags?: string[]; size?: number; done?: boolean; owner?: { name: string }; note?: string };
type Narrow = { id: number };
type Other = { extra: string; size: string };

function narrowed(wide: Wide): Narrow {
  return { ...wide };
}

function merged(wide: Wide, other: Other): Narrow {
  return { ...wide, ...other };
}

function withUnknown(wide: Wide, text: string): Narrow {
  return { ...wide, ...JSON.parse(text), id: 7 };
}

function show(title: string, object: object) {
  console.log(title, JSON.stringify(object), Object.keys(object).join(","));
}

function wideOf(index: number): Wide {
  const wide: Wide = { id: index };
  if (index % 2) wide.title = "t" + index;
  if (index % 3) wide.tags = ["a", String(index)];
  wide.size = index * 1.5;
  if (index % 4 === 0) wide.owner = { name: "o" + index };
  if (index % 5 === 0) wide.done = false;
  return wide;
}

for (let index = 0; index < 8; ++index) {
  const narrow = narrowed(wideOf(index));
  show("narrowed " + index, narrow);
  const any = narrow as any;
  console.log(any.title, any.tags?.length, any.size, any.owner?.name, any.done, "note" in narrow, Object.hasOwn(narrow, "size"));
  any.note = "late";
  delete any.size;
  any.size = "back";
  show("changed " + index, narrow);
  show("copied on " + index, { ...narrow, last: true });

  const both = merged(wideOf(index), { extra: "e" + index, size: "large" });
  show("merged " + index, both);
  console.log(typeof (both as any).size, (both as any).extra);

  show("unknown " + index, withUnknown(wideOf(index), index % 2 ? '{"title":5,"zeta":[1],"id":9}' : '{"alpha":null,"size":{"w":1}}'));
}

const frozen = Object.freeze(narrowed(wideOf(3)));
show("frozen", frozen);
console.log(Object.isFrozen(frozen), Object.getOwnPropertyDescriptor(frozen, "tags")?.writable);
for (const key in narrowed(wideOf(4))) console.log("key", key);
console.log(Object.entries(merged(wideOf(5), { extra: "x", size: "s" })).map(([key, value]) => key + "=" + JSON.stringify(value)).join(" "));
