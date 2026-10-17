// The arms of these unions have the same property names and differ only in the type of a nested object.
// Each object fits one arm, whichever object came before it.
function tell(name: string, f: () => unknown): void {
  try {
    console.log(name + ": " + f());
  } catch (e) {
    console.log(name + ": " + String(e).split("\n")[0]);
  }
}

setTimeout(
  rows => {
    for (const { spec, outer } of rows) tell("three arms, " + spec, () => JSON.stringify({ name: "x", ...outer }));
  },
  0,
  [
    { spec: "two", outer: { inner: { two: "2" } } },
    { spec: "one", outer: { inner: { one: "1" } } },
    { spec: "other", outer: { other: { one: "w" } } },
    { spec: "two again", outer: { inner: { two: "2" } } },
    { spec: "one again", outer: { inner: { one: "1" } } },
  ],
);

setTimeout(
  rows => {
    for (const { spec, outer } of rows) tell("the other order, " + spec, () => JSON.stringify({ name: "x", ...outer }));
  },
  0,
  [
    { spec: "one", outer: { inner: { one: "1" } } },
    { spec: "two", outer: { inner: { two: "2" } } },
    { spec: "other", outer: { other: { one: "w" } } },
    { spec: "one again", outer: { inner: { one: "1" } } },
    { spec: "two again", outer: { inner: { two: "2" } } },
  ],
);

setTimeout(
  rows => {
    for (const { spec, app, pkg } of rows) {
      tell("package files, " + spec, () => JSON.stringify({ name: "app", ...app }));
      tell("package files, " + spec, () => JSON.stringify({ name: "pkg", ...pkg }));
    }
  },
  0,
  [
    { spec: "a star", app: { dependencies: { pkg: "*" } }, pkg: {} },
    { spec: "a star and a version", app: { dependencies: { pkg: "*" } }, pkg: { version: "1.0.0-alpha" } },
    { spec: "an alias", app: { dependencies: { aliased: "npm:pkg@*" } }, pkg: {} },
    { spec: "a catalog", app: { dependencies: { pkg: "catalog:" } }, pkg: { version: "1.0.0" } },
    { spec: "another alias", app: { dependencies: { aliased: "workspace:pkg@*" } }, pkg: {} },
    { spec: "two kinds", app: { devDependencies: { pkg: "workspace:*" }, peerDependencies: { pkg: "^1.0.0" } }, pkg: { version: "1.0.0" } },
  ],
);

setTimeout(
  rows => {
    for (const { spec, outer } of rows) tell("two levels down, " + spec, () => JSON.stringify({ name: "x", ...outer }));
  },
  0,
  [
    { spec: "two", outer: { middle: { inner: { two: 2 } } } },
    { spec: "one", outer: { middle: { inner: { one: 1 } } } },
    { spec: "other", outer: { other: 1 } },
    { spec: "two again", outer: { middle: { inner: { two: 2 } } } },
  ],
);
