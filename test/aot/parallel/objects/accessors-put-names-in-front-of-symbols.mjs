const mark = Symbol("mark");
const show = value => Bun.inspect(value, { compact: true }).replace(/\s+/g, " ");

function copied() {
  const parcel = { [mark]: 2, get weight() { return 4; } };
  return { ...parcel, depth: 1 };
}

function copiedTwice() {
  const parcel = { size: 1, [mark]: 2, get weight() { return 3; } };
  return { ...{ ...parcel } };
}

function copiedInPlace(size) {
  return { ...{ [mark]: size, get weight() { return 3; }, set weight(value) {} }, depth: size };
}

function rest() {
  const parcel = { [mark]: 2, size() { return 1; }, get weight() { return 3; } };
  const { size, ...others } = parcel;
  return others;
}

function restWithoutAccessor() {
  const parcel = { [mark]: 2, size: 1, get weight() { return 3; } };
  const { weight, ...others } = parcel;
  return others;
}

function withoutAccessor() {
  const made = { [mark]: 1, depth: 1, weight: 2 };
  return { ...made, size: 1 };
}

const both = make => {
  const made = make();
  return [made, { ...made }, Object.assign({}, made), Object.assign({ first: 0 }, made), { first: 0, ...made }];
};

for (let turn = 0; turn < 3; turn++) {
  for (const make of [copied, copiedTwice, copiedInPlace, rest, restWithoutAccessor, withoutAccessor]) console.log(make.name, both(() => make(turn)).map(show).join(" ; "));
}
