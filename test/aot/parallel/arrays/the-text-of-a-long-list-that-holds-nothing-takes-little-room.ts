// `Array(n)` of compiled code keeps its places side by side from the start, and the engine's own join keeps an entry for each place of such a list: 260 MB for four million holes.
// The run time's own join keeps nothing for a place. It answers however the text of the list is asked for. The sibling of test/aot/parallel/arrays/long-arrays-that-hold-little-are-joined.ts.
const places = 2 ** 22;
const peak = () => process.resourceUsage().maxRSS * 1024;
function ask(what: string, how: (list: unknown[]) => string) {
  const list = Array(places);
  const before = peak();
  const text = how(list);
  const grown = peak() - before;
  console.log(what + ":", text.length, grown > 8 * text.length + 2 ** 26 ? "and the process grew by " + Math.round(grown / 2 ** 20) + " MB" : "in little room");
}
ask("list.toString()", list => list.toString());
ask("String(list)", list => String(list));
ask("`${list}`", list => `${list}`);
ask('list.join(",")', list => list.join(","));
ask("list.toLocaleString()", list => list.toLocaleString());
