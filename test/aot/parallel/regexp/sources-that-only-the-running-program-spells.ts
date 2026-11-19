// A program can put the source of a regular expression together while it runs, so that no file of the build spells it: in a loop, and by replacing parts of the source of another one.
const pieces = ["pattern", "Built", "In", "A", "Loop"];
const turns = process.argv.length > 99 ? 0 : pieces.length;
let source = "";
for (let at = 0; at < turns; at++) source += pieces[at];
const first = new RegExp(source + "[0-9]+");
function edit(regex: RegExp) {
  let text = regex.source;
  const editor = {
    replace(name: string, value: string) {
      text = text.replace(name, value);
      return editor;
    },
    get: () => new RegExp(text, "i"),
  };
  return editor;
}
const second = edit(/^headAndtail$/).replace("head", "patternBuilt").replace("tail", "ByReplacing").get();
console.log(first.test(source + "12"), first.test(source), first.source, first.flags);
console.log(second.test("PATTERNBUILTANDBYREPLACING"), second.test("x"), second.source, second.flags);
