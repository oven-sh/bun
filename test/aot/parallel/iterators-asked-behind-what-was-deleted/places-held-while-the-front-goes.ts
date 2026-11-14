// Sets and maps of which nothing is known are stepped by calls of `next`, while members are deleted in front, in the middle and at the end, come again, and the table is replaced (it grows, it is cleared).
// An iterator made before a deletion and stepped behind it, one that holds a place, and a new one must each hand out what the order of insertion says.
(globalThis as any).shelfOfTheSteps = { set: new Set<number>(), other: new Set<string>(), map: new Map<string, number>() };
const shelf: any = (globalThis as any).shelfOfTheSteps;
const lines: string[] = [];
function step(iterator: any): string { const answer = iterator.next(); return answer.done ? "done" : JSON.stringify(answer.value); }
function rest(iterator: any): string { const all: string[] = []; for (let answer = iterator.next(); !answer.done; answer = iterator.next()) all.push(JSON.stringify(answer.value)); return "[" + all.join(" ") + "]"; }
function say(what: string, ...said: string[]) { lines.push(what + ": " + said.join(" . ")); }

for (let n = 0; n < 10; n++) shelf.set.add(n);
const early = shelf.set.values();
for (let turn = 0; turn < 3; turn++) { const first = shelf.set.values().next().value; say("the first", String(first)); shelf.set.delete(first); }
say("made before the deletions, stepped behind them", step(early));
const holder = shelf.set[Symbol.iterator]();
say("holds a place", step(holder), step(holder));
for (const gone of [3, 4, 5]) shelf.set.delete(gone);
say("the front went under it", step(shelf.set.values()), step(holder), step(early));
shelf.set.delete(8);
say("one in the middle", step(shelf.set.values()), rest(shelf.set.values()));
shelf.set.add(3);
say("3 comes again, last", rest(shelf.set.values()), rest(shelf.set.keys()), rest(shelf.set.entries()));
say("those that held places go on", rest(holder), rest(early));

const whileEmptying = shelf.set.values();
while (shelf.set.size) shelf.set.delete(shelf.set.values().next().value);
say("emptied from the front", step(shelf.set.values()), step(shelf.set.values()), String(shelf.set.size));
const madeOnEmpty = shelf.set.values();
shelf.set.add(42); shelf.set.add(43);
say("filled again", step(shelf.set.values()), step(madeOnEmpty), step(whileEmptying), rest(madeOnEmpty));

const acrossGrowth = shelf.set.values();
say("one step", step(acrossGrowth));
for (let n = 100; n < 400; n++) shelf.set.add(n);
for (const gone of [42, 43, 100, 101]) shelf.set.delete(gone);
say("the table grew and lost its front", step(shelf.set.values()), step(acrossGrowth), step(acrossGrowth));
for (let n = 102; n < 390; n++) shelf.set.delete(shelf.set.values().next().value);
say("most of it went", rest(shelf.set.values()), rest(acrossGrowth));

const acrossClear = shelf.set.values();
say("one step", step(acrossClear));
shelf.set.clear();
say("cleared", step(shelf.set.values()));
shelf.set.add(7); shelf.set.add(8); shelf.set.delete(7);
say("filled behind the clear", step(shelf.set.values()), rest(acrossClear));

for (let n = 0; n < 6; n++) { shelf.other.add("o" + n); shelf.map.set("k" + n, n); }
let both = "";
while (shelf.other.size || shelf.map.size) {
    if (shelf.other.size) { const first = shelf.other.values().next().value; both += first + " "; shelf.other.delete(first); }
    if (shelf.map.size) { const [key, value] = shelf.map.entries().next().value; both += key + "=" + value + "," + shelf.map.keys().next().value + "," + shelf.map.values().next().value + " "; shelf.map.delete(key); }
    if (both.length < 60) shelf.map.set("late" + both.length, both.length);
}
say("two at once", both);

for (let n = 0; n < 8; n++) shelf.map.set("m" + n, n);
const keys = shelf.map.keys(), values = shelf.map.values(), entries = shelf.map.entries();
say("a map's three", step(keys), step(values), step(entries));
shelf.map.delete("m0"); shelf.map.delete("m1"); shelf.map.delete("m7");
say("its front and its end went", step(shelf.map.keys()), step(keys), step(values), step(entries));
shelf.map.set("m0", 100); shelf.map.set("m3", 300);
say("one comes again, one is written", rest(shelf.map.entries()), rest(keys), rest(values), rest(entries));
for (const line of lines) console.log(line);
