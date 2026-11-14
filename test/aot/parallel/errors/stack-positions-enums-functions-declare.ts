// Each function declares an enum, and a conversion right behind the declaration asks where its caller stands. Bun's transpiler prints the members of an enum in
// a function, which it calls behind them, so the function around the enum stands at the last token of the members.
function frames(): string {
  return String(new Error("here").stack)
    .split("\n")
    .slice(2, 4)
    .map(line => line.trim().replace(/\(?[^\s()]*[\\/]/, "("))
    .join(" ; ");
}
function show(f: () => string) {
  console.log(f.name, f());
}
show(function sumWithLength() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.First + Kind.Second;
  return `${{ toString: () => String(frames()) }}`;
});
show(function sumOfLiterals() {
  enum Kind {
    First = 53,
    Second = 2,
  }
  const value = Kind.First + Kind.Second;
  return `${{ toString: () => String(frames()) }}`;
});
show(function lengthAlone() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  const value = Kind.Second;
  return `${{ toString: () => String(frames()) }}`;
});
show(function noVariable() {
  enum Kind {
    First = 53,
    Second = "ab".length,
  }
  return `${{ toString: () => String(frames()) }}`;
});
show(function literalMembersNoVariable() {
  enum Kind {
    First = 53,
    Second = 2,
  }
  return `${{ toString: () => String(frames()) }}`;
});
function give(n: number): number {
  return n;
}
show(function lastIsText() {
  enum Kind {
    First = 53,
    Second = "text",
  }
  return `${{ toString: () => String(frames()) }}`;
});
show(function lastIsCall() {
  enum Kind {
    First = 53,
    Second = give(2),
  }
  return `${{ toString: () => String(frames()) }}`;
});
show(function lastHasNoInitializer() {
  enum Kind {
    First = give(1),
    Second = 3,
    Third,
  }
  return `${{ toString: () => String(frames()) }}`;
});
show(function noMembers() {
  enum Kind {}
  return `${{ toString: () => String(frames()) }}`;
});
show(function lastIsJoinedText() {
  enum Kind {
    First = "a",
    Second = First + "b",
  }
  return `${{ toString: () => String(frames()) }}`;
});
show(function constantEnum() {
  const enum Kind {
    First = 1,
    Second = 2,
  }
  return `${{ toString: () => String(frames()) }}` + Kind.Second;
});
show(function twoDeclarations() {
  enum Kind {
    First = 1,
  }
  enum Kind {
    Second = 2,
  }
  return `${{ toString: () => String(frames()) }}`;
});
enum AtTheTop {
  First = 1,
  Second = 2,
}
console.log(`${{ toString: () => String(frames()) }}`);
