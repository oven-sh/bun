class Item {
  constructor(size: any, name: any) {
  }
}
function plain(value: any) {
  return typeof value === "object"? "object" : value;
}
function add(total: any, value: any) {
  return plain(total) + plain(value);
}
function show(value: any): string {
  return String(value);
}
function told(error: any): string {
  return error?.name + " " + String(error?.message).replace(/ \(.*/s, "");
}
interface Holder {
  side: "left" | "right";
}
class Global {
}
function read0(holder: Holder, count: number) {
  let total = 0;
  const get2 = (): "left" | "right" => holder.side;
  for (let turn = 0; turn < count; turn++) {
      const bound3: "left" | "right" = get2();
      try {
        const kept4 = bound3[0];
        total = add(total, kept4);
      } catch  {
      }
  }
  return total;
}
const holders: any[] = [() => (Object.assign(Global, { side: "left", pair: ((new Int32Array) as any), items: ((new Set) as any) })), () => (Global), () => (Object.assign(Global, { side: "right", pair: ((new String) as any), items: [] })), () => (Object.assign(Global, { side: "left", pair: (({ length: 2, 0: 5 }) as any), items: [new Item(1, "n")] }))];
for (const make of holders) {
  let holder;
  try {
    holder = make();
  } catch  {
  }
  try {
    console.log(show(read0(holder, 4)));
  } catch  {
  }
}
