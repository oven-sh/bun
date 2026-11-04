// A list of numbers is spliced with the elements of a list of holes and is asked what it holds.
const list: number[] = [1, 2, 3];
list.splice(1, 0, ...new Array<number>(1));
console.log("length " + list.length);
console.log("findIndex " + list.findIndex(n => n === undefined));
console.log("some " + list.some(n => n === undefined));
console.log("every " + list.every(n => n !== undefined));
console.log("filter " + list.filter(n => n === undefined).length);
console.log("filter by typeof " + list.filter(n => typeof n !== "number").length);
console.log("map " + list.map(n => typeof n).join());
console.log("map + 1 " + list.map(n => n + 1).join());
console.log("reduce " + list.reduce((text, n) => text + typeof n + " ", ""));
console.log("findLast " + typeof list.findLast(n => typeof n !== "number" || n > 100));
console.log("flatMap " + list.flatMap(n => [typeof n]).join());
console.log("Array.from " + Array.from(list, n => typeof n).join());
let walked = "";
for (const n of list) walked += typeof n + " ";
console.log("for of " + walked);
let indexed = "";
for (let i = 0; i < list.length; i++) indexed += typeof list[i] + " ";
console.log("by index " + indexed);
let sum = 0;
for (const n of list) sum += n;
console.log("sum " + sum);
let visited = 0;
list.forEach(n => {
  if (n === undefined) visited += 100;
  else visited++;
});
console.log("forEach " + visited);
console.log("spread " + [...list].map(n => typeof n).join());
console.log("join " + list.join("-"));
console.log("JSON " + JSON.stringify(list));
console.log("keys " + Object.keys(list).join());

export {};
