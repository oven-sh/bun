// the second and the third argument are undefined in some calls and a function, a list, a number or a text in others
// COUNT: operation:operationAOTStringBuilderBegin >= 1
type Row = { id: number; name: string; inner: { deep: boolean } };
function write(row: Row, replacer?: any, space?: any): string {
  return JSON.stringify(row, replacer, space);
}
function writeWithNulls(row: Row): string {
  return JSON.stringify(row, null, undefined);
}
const row: Row = { id: 1, name: "a", inner: { deep: true } };
for (let i = 0; i < 3; i++) console.log(write(row));
console.log(write(row, undefined, undefined));
console.log(write(row, null, null));
console.log(write(row, (key: string, value: unknown) => (key === "id" ? 100 : value)));
console.log(write(row, ["name", "inner"]));
console.log(write(row, null, 2));
console.log(write(row, null, "--"));
console.log(write(row, null, 0));
console.log(write(row, null, ""));
console.log(write(row, null, new Number(1)));
console.log(write(row, {}, {}));
for (let i = 0; i < 3; i++) console.log(writeWithNulls(row));
