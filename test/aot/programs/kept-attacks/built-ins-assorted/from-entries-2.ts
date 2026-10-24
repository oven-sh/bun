// Built ins assorted: from entries. It prints what plain Bun prints.
function run(): string {
  const pairs: [string, number][] = [["first", 1]];
  return JSON.stringify(Object.fromEntries(pairs));
}
console.log(run());
