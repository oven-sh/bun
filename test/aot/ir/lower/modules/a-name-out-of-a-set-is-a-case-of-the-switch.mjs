// The name of a load comes out of a Set that the file fills with written texts: through its constructor, through add(), or through a spread of it into a list.
// A for..of hands its body what the Set holds, so each text is a case of the switch in front of the load.
// A Set that goes somewhere else, or that is handed a text which the build has not read, names nothing.

// RUN(ADDED): lower
// ADDED-LABEL: function {{*}}name="added"
// ADDED: SwitchString {{*}}strings=["./imports/pages/first.ts", "./imports/pages/second.ts"]
// ADDED: = ImportModule module=m
// ADDED: = ImportModule module=m
// ADDED: = ImportDynamic {{*}}[allNamesAreKnown]

// RUN(CONSTRUCTED): lower
// CONSTRUCTED-LABEL: function {{*}}name="constructed"
// CONSTRUCTED: SwitchString {{*}}strings=["./imports/pages/first.ts", "./imports/pages/second.ts"]
// CONSTRUCTED: = ImportModule module=m
// CONSTRUCTED: = ImportModule module=m
// CONSTRUCTED: = ImportDynamic {{*}}[allNamesAreKnown]

// RUN(SPREAD): lower
// SPREAD-LABEL: function {{*}}name="spread"
// SPREAD: SwitchString {{*}}strings=["./imports/pages/first.ts", "./imports/pages/second.ts"]
// SPREAD: = ImportModule module=m
// SPREAD: = ImportModule module=m
// SPREAD: = ImportDynamic {{*}}[allNamesAreKnown]

// RUN(ASKED): lower
// ASKED-LABEL: function {{*}}name="asked"
// ASKED: SwitchString {{*}}strings=["./imports/pages/first.ts"]
// ASKED: = ImportDynamic {{*}}[allNamesAreKnown]

// RUN(HANDED): lower
// HANDED-LABEL: function {{*}}name="handedOn"
// HANDED-NOT: SwitchString
// HANDED: = ImportDynamic
// HANDED-NOT: allNamesAreKnown
// HANDED: Return

// RUN(UNREAD): lower
// UNREAD-LABEL: function {{*}}name="unread"
// UNREAD-NOT: allNamesAreKnown
// UNREAD: Return

// RUN(STORED): lower
// STORED-LABEL: function {{*}}name="storedAgain"
// STORED-NOT: SwitchString
// STORED: = ImportDynamic
// STORED-NOT: allNamesAreKnown
// STORED: Return

export async function added() {
  const names = new Set();
  names.add("./imports/pages/first.ts");
  names.add("./imports/pages/second.ts");
  for (const name of names) await import(name);
}

export async function constructed() {
  const names = new Set(["./imports/pages/second.ts", "./imports/pages/first.ts"]);
  for (const name of names) await import(name);
}

export async function spread() {
  const names = new Set(["./imports/pages/second.ts"]);
  for (const name of [...names, "./imports/pages/first.ts"]) await import(name);
}

export async function asked(other) {
  const names = new Set(["./imports/pages/first.ts"]);
  if (names.has(other)) return;
  for (const name of names) await import(name);
}

export async function handedOn(fill) {
  const names = new Set(["./imports/pages/first.ts"]);
  fill(names);
  for (const name of names) await import(name);
}

export async function unread(other) {
  const names = new Set(["./imports/pages/first.ts"]);
  names.add(other);
  for (const name of names) await import(name);
}

export async function storedAgain(other) {
  let names = new Set(["./imports/pages/first.ts"]);
  names = other;
  for (const name of names) await import(name);
}
