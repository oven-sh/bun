// Built ins assorted: store other type. It prints what plain Bun prints.
type Table = { first: (value: string) => boolean; second: (value: string) => string };
const table: Table = { first: value => value.length > 1, second: value => value + "x" };
function measure(value: string) {
  return [table.first(value), table.second(value)];
}
console.log(JSON.stringify(measure("/a")));
(table as any).second = (...parts: string[]) => "mine:" + parts.join("|");
(table as any).first = undefined;
try {
  measure("/a");
} catch (error) {
  console.log((error as Error).name);
}
