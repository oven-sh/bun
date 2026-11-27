// A parameter that an async body at the top of a module fills through a copied getter: the build ended under proof-checks, where the argument's own type is wider than what is shown of it.
enum Mode {
  Off,
}
function plain(value: any) {
  return typeof value === "object"? "object" : value;
}
function add(total: any, value: any) {
  return plain + plain(value);
}
function show(value: any): string {
  return typeof value === "bigint" ? value + "n" : String(plain(value)).slice(0, 300);
}
interface Holder {
  mode: Mode;
}
class Global {
}
function read0(holder: Holder, count: number): any {
  let total: any = 0;
  const get0 = (): Mode => holder.mode;
  for (let turn = 0; turn < count; turn++) {
    if (turn > 0) total = add(get0() + 1, total);
  }
}
async function read2(holder: Holder, count: number): Promise<any> {
  let total: any = 0;
    for (let inner = 0; inner < 3; inner++) {
      try {
      } catch (error) {
        total = add(total, (error as any).name);
      }
    }
}
const holders: any[] = [() => (Global), () => (Object.assign(Global, { mode: Mode.Off })), () => (Object.assign(Global, { mode: Mode.Off }))];
for (const make of holders) {
  let holder: any;
  try {
    holder = make();
  } catch (error) {
  }
  try {
    console.log(show(read0(holder, 4)));
  } catch (error) {
  }
  try {
    console.log(show(await read2(holder, 3)));
  } catch (error) {
  }
}
