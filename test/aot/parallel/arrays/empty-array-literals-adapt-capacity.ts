// Each function makes an empty array at one place in the code, thousands of times, and fills it with a fixed or a changing number of elements.
// The place learns how much room its arrays use, so later arrays are born with other room than the first. What a program sees stays the same.
interface Holder<T> { items: T[]; next: Holder<T> | null }

function numbers(count: number, seed: number): Holder<number> {
  const holder: Holder<number> = { items: [], next: null };
  for (let i = 0; i < count; i++) holder.items.push(seed + i + 0.5);
  return holder;
}
function integers(count: number, seed: number): Holder<number> {
  const holder: Holder<number> = { items: [], next: null };
  for (let i = 0; i < count; i++) holder.items.push((seed + i) | 0);
  return holder;
}
function texts(count: number, seed: number): Holder<string> {
  const holder: Holder<string> = { items: [], next: null };
  for (let i = 0; i < count; i++) holder.items.push("t" + (seed + i));
  return holder;
}
function mixed(count: number, seed: number): Holder<unknown> {
  const holder: Holder<unknown> = { items: [], next: null };
  for (let i = 0; i < count; i++) holder.items.push(i % 3 === 0 ? seed : i % 3 === 1 ? seed + 0.25 : "m" + seed);
  return holder;
}

function digest(holder: Holder<unknown>): number {
  let sum = holder.items.length * 31;
  for (let i = 0; i < holder.items.length; i++) {
    const item = holder.items[i];
    sum = (sum * 33 + (typeof item === "number" ? Math.round(item * 4) : String(item).length)) | 0;
  }
  return sum;
}

const makers: [string, (count: number, seed: number) => Holder<unknown>][] = [
  ["numbers", numbers],
  ["integers", integers],
  ["texts", texts],
  ["mixed", mixed],
];
// Long enough at each length for a place to take the length up, and to give it up again.
const lengths = [0, 1, 0, 3, 2, 5, 7, 20, 1, 0, 130, 0];

function run(label: string) {
  for (const [name, make] of makers) {
    const sums: number[] = [];
    for (const length of lengths) {
      let sum = 0;
      let kept: Holder<unknown> | null = null;
      for (let turn = 0; turn < 1500; turn++) {
        const holder = make(length, turn);
        sum = (sum + digest(holder)) | 0;
        if (turn % 97 === 0) {
          holder.next = kept;
          kept = holder;
        }
      }
      for (let holder = kept; holder; holder = holder.next) {
        holder.items.push(holder.items.length as never);
        sum = (sum ^ digest(holder)) | 0;
      }
      sums.push(sum);
    }
    console.log(label, name, sums.join(" "));
  }
}

run("plain");
const born = numbers(0, 0).items;
console.log(born.length, 0 in born, born[0], Object.keys(born).length, JSON.stringify(born));

// From here on an object that others inherit from has an index that cannot be written, and arrays are made in the form that asks above them.
const above = {};
const heir: Record<number, unknown> = Object.create(above);
Object.defineProperty(above, 0, { value: "from above", writable: false });
run("with an index above an object");
const late = numbers(1, 1).items;
late.length = 3;
console.log(heir[0], late.length, 1 in late, late[0], integers(0, 0).items[0], texts(0, 0).items[0], mixed(2, 9).items.join());
