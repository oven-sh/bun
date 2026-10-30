// `bun run` puts 4 in place of every `Size.Length`. An executable reads the object of the enum, with `--aot` and without.
// Reference: bun build --compile
function attempt(read: () => unknown) {
  try {
    return read();
  } catch (error) {
    return (error as Error).name;
  }
}

function declareInside() {
  console.log(
    "before the enum in a function",
    attempt(() => Local.Length),
  );
  enum Local {
    Length = "text".length,
  }
  console.log("after the enum in a function", Local.Length);
  (Local as Record<string, unknown>).Length = "stored";
  console.log("stored in a function", Local.Length);
}

console.log(
  "before the enum",
  attempt(() => Size.Length),
);
declareInside();
enum Size {
  Length = "text".length,
}
console.log("after the enum", Size.Length, Size[4]);
(Size as Record<string, unknown>).Length = "stored";
console.log("stored", Size.Length);
