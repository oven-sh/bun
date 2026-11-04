// An error quotes what Bun's printer has made of the file: here of a tagged template that holds letters outside ASCII.
// Todo: row 4133: since oven-sh/bun#44833 plain Bun quotes its own lowering of such a template, `String.raw(__rawTemplate_..([..])`..`)`. Compiled, the quote is the source's.
const o = { f: 1 };
const tries = [
  () => o.nothing(String.raw`a\nb字`),
  () => o.nothing(String.raw`é😀${o.f}ÿ`),
];
for (const attempt of tries) {
  try {
    attempt();
    console.log("nothing thrown");
  } catch (error) {
    console.log(JSON.stringify(String(error.message)));
  }
}
