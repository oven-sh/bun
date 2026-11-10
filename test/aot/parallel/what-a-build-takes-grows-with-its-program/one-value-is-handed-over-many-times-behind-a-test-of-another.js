// `if (piece.kind !== 220 && piece.kind !== 219) return many(last, last, .., last) || piece.kind === 173;`: `piece` comes in untyped, so its first read parts a way that knows it from one that does not, and
// behind the place where they meet one call hands ANOTHER value over SIZE times to a small function that is copied in place. What is looked at ahead asks of each argument what the callee does with it first:
// once an argument, of the one parameter that it names. Three callees in turn: one reads its last parameter alone, one hands them all on to a call, one reads them all in one operation.
// It writes a program: SIZE says how many arguments each call hands over, PASSES how many functions hold such a call.
// Sizes: 500 1000 2000
// Passes: 6
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2),
  copies = Number(process.env.PASSES ?? 3);
const names = Array.from({ length: size }, (_, index) => `q${index}`);
const handed = Array(size).fill("last").join(", ");
const lines = [
  "class Piece { constructor(kind, label) { this.kind = kind; this.label = label; } }",
  "function counts() { return arguments.length === 0; }",
];
for (let copy = 0; copy < copies; copy++) {
  const answer = [`${names[size - 1]} === undefined`, `counts(${names.join(", ")})`, "`" + names.map(name => "${" + name + "}").join("") + "`.length === 0"][copy % 3];
  lines.push(`function many${copy}(${names.join(", ")}) { return ${answer}; }`);
  lines.push(`function isPutOff${copy}(piece, last) {`);
  lines.push(`  if (piece.kind !== 220 && piece.kind !== 219) return many${copy}(${handed}) || piece.kind === 173;`);
  lines.push("  return !(last && last === piece.label);");
  lines.push("}");
}
lines.push(`const held = [${Array.from({ length: copies }, (_, copy) => `isPutOff${copy}`).join(", ")}];`);
lines.push("const label = new Piece(80);");
lines.push("let yes = 0;");
lines.push("for (const asked of held) {");
lines.push("  for (let kind = 150; kind < 280; kind++) {");
lines.push("    const piece = new Piece(kind, kind & 1 ? label : undefined);");
lines.push("    yes += Number(asked(piece, undefined)) + 2 * Number(asked(piece, label));");
lines.push("  }");
lines.push(`  for (const text of ['{"kind":187}', '{"kind":173,"label":1}', '{"kind":220}']) yes = (yes * 2 + Number(asked(JSON.parse(text), undefined))) % 1000003;`);
lines.push("}");
lines.push("console.log(yes);");
console.log(lines.join("\n"));
