// Impostors drafts: scratch wh scratch. It prints what plain Bun prints.
function letterAt(text: string, wanted: string): string {
  return text[text.indexOf(wanted)];
}
console.log(letterAt("abc", "b"));
try {
  console.log(letterAt("abc", "z").toUpperCase());
} catch (error) {
  console.log(error instanceof TypeError);
}
export {};
