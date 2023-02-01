# `bun wiptest`

---

`wiptest` is a Jest like test runner built into the bun runtime.

### expect(...).toMatchSnapshot(hint?: string): void

This is very similar to Jest's `toMatchSnapshot`, a tool to test if a visual component or object has changed. If a file needs to have a new snapshot generated then pass the `--updateSnapshot` argument to `bun wiptest` and a new snapshot file will be generated.

There are two key differences between bun's implementation of `toMatchSnapshot` and Jest's implementation:

1) The formatting of snapshot files is provided by bun's formatter and not the one that Jest uses which leads to objects to be stringified in a different format than in Jest. If migrating from a Jest codebase you will need to `--updateSnapshot` for your tests to pass.

2) This does not currently support the [Property Matchers](https://jestjs.io/docs/snapshot-testing#property-matchers) argument. This will be updated after some features are added to wiptest.
