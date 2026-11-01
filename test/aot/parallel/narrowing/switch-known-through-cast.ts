// Flags: --aot-check=verify-each-pass
// Under a handler the variable of an unrolled loop stays a cast of the string it holds, typed as the whole union. The switch is decided by the string; what its case hands on has the type of the case.
type Kind = "circle" | "square" | "box";
function assigned(kind: Kind): string {
  let name: string;
  switch (kind) {
    case "box":
      name = "a " + kind;
      break;
    case "circle":
    case "square":
      name = "one " + kind;
      break;
  }
  return name;
}
const kinds: Kind[] = ["circle", "square", "box"];
try {
  for (const kind of kinds) console.log(kind, assigned(kind));
} catch (caught) {
  throw caught;
} finally {
  (globalThis as any).loopsLeft = ((globalThis as any).loopsLeft | 0) + 1;
}
console.log((globalThis as any).loopsLeft);
