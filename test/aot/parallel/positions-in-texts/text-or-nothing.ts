// the text may be undefined, and `?.` stands in the test alone
function code(text: string | undefined, pos: number): string {
  try {
    if (pos < (text?.length ?? 9)) return String(text!.charCodeAt(pos));
    return "outside";
  } catch (error) {
    return (error as Error).name;
  }
}
function deed(): string {
  return code("abc", 1) + "|" + code("abc", 4) + "|" + code(undefined, 4);
}
console.log(deed());
let turns = "";
for (let turn = 0; turn < 40; turn++) turns = deed();
console.log(turns);
