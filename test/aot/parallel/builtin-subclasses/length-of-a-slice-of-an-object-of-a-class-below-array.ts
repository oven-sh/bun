// The length of what slice() makes of an object of a class below Array, in a function that is called through `any` with arguments it does not take.
function note(value: unknown): void {}
function writeAsText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "null";
  }
}
let extra: undefined | null | object = undefined;
function sliceARow(): void {
  class Row extends (Array as any) {}
  try {
    const count: number = 3;
    const row: any = new (Row as any)(count);
    const length: number = row.slice().length;
    const parsed: any = JSON.parse(writeAsText((length as any)?.length));
    console.log(length, parsed, row instanceof Row, row.slice() instanceof Row);
  } catch (error) {
    console.log("caught", String(error));
  }
}
try {
  note((sliceARow as any)({ a: 1 }, extra, new Proxy({}, {})));
  try {
    note((sliceARow as any)({ a: 1 }, extra, new Proxy({}, {})));
  } catch (error) {}
} catch (error) {}
