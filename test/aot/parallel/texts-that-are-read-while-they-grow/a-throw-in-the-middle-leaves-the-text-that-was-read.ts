// COUNT: operation:operationAOTStackStringBuilderToString >= 10
// What reads the text throws, and a handler outside has the last text that was read.
let lastRead = "";
function check(text: string, most: number): void {
  lastRead = text;
  if (text.length > most) throw new RangeError("too long: " + text.length);
}
function build(parts: string[], most: number): string {
  let text = "";
  for (const part of parts) {
    text += part;
    if (part !== "x") check(text, most);
  }
  return text;
}
const parts = ["┌", "─", "x", "─", "┐", "yy", "│", "z", "│"];
for (const most of [0, 1, 3, 4, 6, 7, 20]) {
  try {
    console.log(most, JSON.stringify(build(parts, most)));
  } catch (error) {
    console.log(most, (error as Error).message, JSON.stringify(lastRead));
  }
}
