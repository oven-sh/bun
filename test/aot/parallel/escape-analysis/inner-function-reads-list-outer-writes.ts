// An inner function reads an element of a list that the outer function was given, and adds to a variable of the outer function. The build checks itself and is told nothing of what the lists
// hold, so that each read of an element keeps its slow way. The output is that of plain Bun.
// Flags: --aot-validate --aot-disable=flow:ProvenContents
function through(source: readonly string[], texts: readonly string[]): string {
  let result = "";
  for (const text of texts) add(text);
  return result;

  function add(text: string) {
    result += source[0].indexOf(text) + ";";
  }
}

function throughItself(source: readonly string[], texts: readonly string[], depth: number): string {
  if (depth > 0) return throughItself(source, texts, depth - 1);
  let position = 0;
  let result = "";
  for (const text of texts) add(text);
  return result;

  function add(text: string) {
    const at = source[0].indexOf(text, position);
    result += at + ":" + source.length + ";";
    if (at >= 0) position = at + text.length;
  }
}

for (let round = 0; round < 3; round++) {
  console.log(through(["pre" + round + "post"], ["pre", "post", "none"]));
  console.log(throughItself(["pre" + round + "-mid-" + round + "post"], ["pre", "-mid-", "post"], 2));
}
