// parses one object of each of the eight arms of a tagged union, the tag first, with JSON.parse<T>()
interface Opened { type: "opened"; id: number; ope: number }
interface Closed { type: "closed"; id: number; clo: number }
interface Moved { type: "moved"; id: number; mov: number }
interface Noted { type: "noted"; id: number; not: number }
interface Linked { type: "linked"; id: number; lin: number }
interface Merged { type: "merged"; id: number; mer: number }
interface Renamed { type: "renamed"; id: number; ren: number }
interface Removed { type: "removed"; id: number; rem: number }
type Entry = Opened | Closed | Moved | Noted | Linked | Merged | Renamed | Removed;
const operations = 8;
const texts = [{ type: "opened", id: 1, ope: 2 }, { type: "closed", id: 1, clo: 2 }, { type: "moved", id: 1, mov: 2 }, { type: "noted", id: 1, not: 2 }, { type: "linked", id: 1, lin: 2 }, { type: "merged", id: 1, mer: 2 }, { type: "renamed", id: 1, ren: 2 }, { type: "removed", id: 1, rem: 2 }].map(entry => JSON.stringify(entry));
let total = 0;

kernel: {
  for (let i = 0; i < operations; i++) total += JSON.parse<Entry>(texts[i]).id;
}

console.log(total);
