// A loop that ends where either of two tests fails, inside a callback that is copied into the loop around it: the first test is in the header, its branch in a block of its own.
let steps = 0;
const small: number[] = [10, 20, 30];
class Item {
  kind = "item";
  size: number = 0;
  name: string;
  list: number[] = [1];
  next: Item | null = null;
  constructor(size: any, name: any) {
    this.size = size;
    this.name = name;
  }
  area(): number {
    return this.size * 2;
  }
}
class Wide extends Item {
  wide: number = 1;
  area(): number {
    return super.area() + this.wide;
  }
}
class Other {
  kind = "other";
  weight: number;
  constructor(weight: any) {
    this.weight = weight;
  }
  area(): number {
    return this.weight;
  }
}
const kept = new Item(6, "kept");
function plain(value: any): any {
  return typeof value === "function" ? "function" : typeof value === "symbol" ? "symbol" : typeof value === "object" && value !== null ? "object" : value;
}
function add(total: any, value: any): any {
  return plain(total) + plain(value);
}
function show(value: any): string {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(plain(value)).slice(0, 300);
}
function told(error: any): string {
  return error?.name + " " + String(error?.message).replace(/ \(.*/s, "").replace(/^(?!undefined |null ).* is not/s, "is not");
}
class Holder {
  name: string;
  size: number;
  either: Item | Other;
  constructor(name: any, size: any, either: any) {
    this.name = name;
    this.size = size;
    this.either = either;
  }
  getsize(): number {
    return this.size;
  }
  geteither(): Item | Other {
    return this.either;
  }
}
let sharedname: string = "";
let sharedsize: number = NaN;
let sharedeither: Item | Other = new Wide(2, "w");
function change(holder: Holder, turn: number): void {
  if (turn === 1) Reflect.set(holder, "size", ((new Proxy([1, 2], {})) as any));
}
function read1(holder: Holder, count: number): any {
  let total: any = 0;
  for (let turn = count; turn > 0; turn--) {
    [0, 1].forEach(() => {
      for (let at = 0; at < holder.size && at < 40; at++) total += at;
    });
    change(holder, turn);
    try {
      total = add(total, holder.either.area());
    } catch (error) {
      total = add(total, (error as any).name);
    }
  }
  total += (sharedeither instanceof Item ? sharedeither.size : sharedeither.weight) as any;
  return total;
}
const holders: any[] = [() => (new Holder("é日", 0, (((function* () { yield 1; yield 2; })()) as any)))];
for (const make of holders) {
  let holder: any;
  try {
    holder = make();
  } catch (error) {
    console.log("made", (error as any)?.name);
    continue;
  }
  try {
    console.log(show(read1(holder, 4)));
  } catch (error) {
    console.log("threw", told(error));
  }
}
try {
  console.log(steps, show(kept.size), small.join());
} catch (error) {
  console.log("threw", told(error));
}
export {};
