// The raw strings of a tagged template whose source has bytes that are not UTF-8. Plain Bun rewrites every character above U+007F in a tagged template to an escape before it runs the file, so its raw strings contain the escapes.
export {};

function describe(text: string): string {
  const codePoints: string[] = [];
  for (const character of text) codePoints.push(character.codePointAt(0)!.toString(16));
  return text.length + ":" + codePoints.join(".");
}

console.log(describe(String.raw`ÿ\né`), describe(String.raw`í €${1}€`));
