const list = ["a", "b", "c"];
const label = "k" + String(list.length);
const ways = [value => value + list.length, value => value + label];
for (const value of list) {
  for (const way of ways) console.log(way(value));
}

const grown = ["x", "y"];
const title = "n" + String(grown.length);
const steps = [
  value => {
    if (grown.length < 40) grown.push(value + grown.length);
    return title;
  },
  value => value + title,
];
for (const value of grown) {
  for (const step of steps) console.log(step(value));
}
console.log(label, title, list.length, grown.length);
