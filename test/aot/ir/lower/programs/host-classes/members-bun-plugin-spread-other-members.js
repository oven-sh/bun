// RUN: lower
// OPTIONS: builtin-modules

// Members of bun plugin by a spread between other members.
console.log("a spread between other members", Object.values({ first: 1, ...Bun.plugin, last: () => 2 }).map(value => (value === undefined ? "undefined" : typeof value === "function" ? "function " + typeof value.name : typeof value)).join());

// CHECK-LABEL: function {{*}}name="last"
