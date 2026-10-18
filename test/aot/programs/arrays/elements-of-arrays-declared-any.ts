const lists: any[] = [
  [1, 2, 3, 4, 5],
  ["a", "b", "c", "d"],
  [0.5, 1.5, 2.5, 3.5],
];
const texts: any[] = ["one", "two", "three"];
const mixed: any[] = [[1, 2, 3], "text", 7, null, { slice: (from: number, to: number) => "own " + from + to }];
let later: any[] = [[1, 2, 3]];
const show = (value: unknown) => JSON.stringify(value) ?? String(value);
for (let i = 0; i < 6; i++) console.log(show(lists[i % 3].slice(1, 3)), lists[i % 3].length, show(lists[i % 3].indexOf(2)));
for (let i = 0; i < 6; i++) console.log(texts[i % 3].slice(1, 3), texts[i % 3].length, texts[i % 3].toUpperCase());
for (let i = 0; i < 10; i++) {
  try {
    console.log(show(mixed[i % 5].slice(1, 3)));
  } catch (error) {
    console.log(error instanceof TypeError ? "TypeError" : String(error));
  }
}
for (let i = 0; i < 4; i++) {
  console.log(show(later[0].slice(0, 2)));
  if (i === 1) later = ["now a text"];
}
lists[1] = "replaced";
lists.push({ slice: () => "pushed" });
for (let i = 0; i < 4; i++) console.log(show(lists[i].slice(1, 3)));
