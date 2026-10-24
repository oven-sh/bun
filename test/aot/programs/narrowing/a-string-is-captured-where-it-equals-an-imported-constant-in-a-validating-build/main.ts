import { READ_TOOL } from "./names";
const later: Array<() => void> = [];
function show(name: string): void {
  console.log("name", name);
}
function onName(name: string): void {
  if (name === READ_TOOL) later.push(() => show(name));
}
function other(): void {}
const table: Array<[string, () => void]> = [];
table.push(["read_comments", other]);
table.push(["write_comments", other]);
for (const [name, handler] of table) {
  handler();
  onName(name);
}
for (const run of later) run();
