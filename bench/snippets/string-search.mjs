import { bench, run } from "../runner.mjs";

const N = 64;
const urls = [];
const filePaths = [];
const csvLines = [];
const sentences = [];
for (let i = 0; i < N; i++) {
  const scheme = i % 4 === 0 ? "http" : "https";
  urls.push(`${scheme}://example${i}.com/some/longer/path/to/a/resource${i}?query=string&value=${i}`);
  const ext = i % 3 === 0 ? ".test.tsx" : i % 3 === 1 ? ".tsx" : ".css";
  filePaths.push(`/Users/someone/projects/my-app-${i}/src/components/Button${i}/index${ext}`);
  csvLines.push(`alpha${i},bravo,charlie,delta,echo,foxtrot,golf,hotel,india,juliett,kilo,lima${i}`);
  sentences.push(`The quick brown fox ${i} jumps over the lazy dog and then runs away into the quick forest ${i}`);
}

bench(`startsWith("https://") x ${N} urls`, () => {
  let count = 0;
  for (let i = 0; i < N; i++) count += urls[i].startsWith("https://");
  return count;
});

bench(`endsWith(".test.tsx") x ${N} paths`, () => {
  let count = 0;
  for (let i = 0; i < N; i++) count += filePaths[i].endsWith(".test.tsx");
  return count;
});

bench(`lastIndexOf("/") x ${N} paths`, () => {
  let total = 0;
  for (let i = 0; i < N; i++) total += filePaths[i].lastIndexOf("/");
  return total;
});

bench(`lastIndexOf("quick") x ${N} sentences`, () => {
  let total = 0;
  for (let i = 0; i < N; i++) total += sentences[i].lastIndexOf("quick");
  return total;
});

bench(`split(",") x ${N} csv lines`, () => {
  let total = 0;
  for (let i = 0; i < N; i++) total += csvLines[i].split(",").length;
  return total;
});

bench(`split(" ") x ${N} sentences`, () => {
  let total = 0;
  for (let i = 0; i < N; i++) total += sentences[i].split(" ").length;
  return total;
});

const wordRegExp = /[a-z]+/g;
bench(`match(global regexp) x ${N} sentences`, () => {
  let total = 0;
  for (let i = 0; i < N; i++) total += sentences[i].match(wordRegExp).length;
  return total;
});

const singleRegExp = /quick ([a-z]+)/;
bench(`match(non-global regexp) x ${N} sentences`, () => {
  let total = 0;
  for (let i = 0; i < N; i++) total += sentences[i].match(singleRegExp).length;
  return total;
});

bench(`substring(8, 24) x ${N} urls`, () => {
  let total = 0;
  for (let i = 0; i < N; i++) total += urls[i].substring(8, 24).length;
  return total;
});

await run();
