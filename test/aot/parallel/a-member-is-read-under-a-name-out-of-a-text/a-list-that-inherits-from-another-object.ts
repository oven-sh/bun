const names: any[] = JSON.parse('["found","other","map","length","0","toSorted","hasOwnProperty"]');
const above = { found: Array.prototype.toSorted, other: Array.prototype.flatMap, toSorted: 5 };
for (const name of names) {
  const list: any = [3, 1, 2];
  Object.setPrototypeOf(list, above);
  const read = list[name];
  console.log(
    name,
    typeof read,
    typeof read === "function" && name !== "hasOwnProperty"
      ? String(read.call([3, 1, 2], (n: number) => [n]))
      : String(read),
  );
}
const bare: any = [1];
Object.setPrototypeOf(bare, null);
for (const name of names) console.log(name, typeof bare[name]);
