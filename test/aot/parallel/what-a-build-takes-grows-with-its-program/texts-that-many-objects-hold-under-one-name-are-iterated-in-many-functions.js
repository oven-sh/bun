// Eight times SIZE objects, each of a shape of its own, hold a text under one name, and SIZE functions iterate what they read under that name off a value of which nothing is known.
// It writes a program: SIZE says how many functions.
// Sizes: 100 200 800
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2);
const out = ['const unseen = (x) => [x][JSON.parse("0")];', "let sum = 0;", "const pages = ["];
for (let at = 0; at < 8 * size; at++) out.push(`  { words: "w${at}", n${at}: ${at} },`);
out.push("];");
for (let at = 0; at < size; at++) {
  out.push(
    `function count${at}(o) { let s = 0; for (const w of o.words) s += w.length; return s; }`,
    `sum += count${at}(unseen(pages[${at}]));`,
  );
}
out.push("console.log(sum);");
console.log(out.join("\n"));
