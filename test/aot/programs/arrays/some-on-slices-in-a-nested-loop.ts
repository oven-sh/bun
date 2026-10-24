// Two counting loops; inside them a fresh array from `slice`, `some` on it and on a slice of it, `map` and `join` over it, and a loop that stores to a field of its elements. Built without the results of the flow analysis: the test of each fresh array lasts across the unknown code in the loop of `some`, in every round
type Item = { text: string; part: string; marked: boolean };

function isLong(text: string): boolean {
  return text.length > 12;
}

function markRuns(words: string[]): string {
  const items: Item[] = words.map(word => ({ text: word, part: word.toUpperCase(), marked: word.length > 6 }));
  for (let start = 0; start < items.length; start++) {
    for (let size = 2; size <= 4 && start + size <= items.length; size++) {
      const run = items.slice(start, start + size);
      if (run.some(item => item.marked) || run.slice(1).some(item => item.text.startsWith("-"))) break;
      if (isLong(run.map(item => item.part).join(" "))) {
        for (const item of run) item.marked = true;
        break;
      }
    }
  }
  return items.map(item => (item.marked ? "*" : item.text)).join(" ");
}

// The callback changes the slice it runs on, and the slice it was taken from.
function shrinkingRuns(words: string[]): string {
  const items: Item[] = words.map(word => ({ text: word, part: word.toUpperCase(), marked: false }));
  let seen = "";
  for (let start = 0; start < items.length; start++) {
    for (let size = 2; size <= 4 && start + size <= items.length; size++) {
      const run = items.slice(start, start + size);
      const rest = run.slice(1);
      if (run.some(item => { run.length = 1; seen += item.text; return item.marked }) || rest.some(item => { rest.pop(); run.push(item); seen += item.part; return item.marked })) break;
      seen += run.length + "" + rest.length + " ";
    }
  }
  return seen;
}

console.log(markRuns("a bb ccc -d eeee fffff g hh iiiiiii j kk".split(" ")));
console.log(markRuns([]));
console.log(markRuns("one two three four five six".split(" ")));
console.log(shrinkingRuns("a bb ccc dddd".split(" ")));
