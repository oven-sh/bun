// A number out of a tuple with a function is captured under a case of a switch in a validating build.
// Flags: --aot-validate
const later: Array<() => void> = [];
function show(level: number, isLow: boolean): void {
  console.log("level", level, isLow);
}
function onLevel(level: number): void {
  switch (level) {
    case 1:
    case 2:
    case 3:
      later.push(() => show(level, level !== 3));
      return;
    default:
      later.push(() => show(-1, false));
  }
}
function other(): void {}
const table: Array<[number, () => void]> = [];
table.push([1, other]);
table.push([3, other]);
table.push([7, other]);
for (const [level, handler] of table) {
  handler();
  onLevel(level);
}
for (const run of later) run();
