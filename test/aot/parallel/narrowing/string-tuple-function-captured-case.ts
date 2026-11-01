// A string out of a tuple with a function is captured under a case of a switch in a validating build.
// Flags: --aot-validate
const later: Array<() => void> = [];
function show(name: string): void {
  console.log("name", name);
}
function onName(name: string): void {
  switch (name) {
    case "one":
      later.push(() => show(name));
      return;
    default:
      later.push(() => show("other"));
  }
}
function other(): void {}
const table: Array<[string, () => void]> = [];
table.push(["one", other]);
table.push(["two", other]);
for (const [name, handler] of table) {
  handler();
  onName(name);
}
for (const run of later) run();
