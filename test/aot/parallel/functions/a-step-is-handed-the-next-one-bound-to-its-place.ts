// Links hang one behind the other: each is handed the call that enters the one behind it, a method bound to the object that walks and to that link.
type Enter = (note?: unknown) => string;
class Link { behind: Link | undefined; constructor(readonly name: string, readonly act: (walk: Walk, enter: Enter, link: Link) => string) {} }
const chain = (...links: Link[]): Link | undefined => { let first: Link | undefined; for (const link of links.reverse()) { const copy = new Link(link.name, link.act); copy.behind = first; first = copy; } return first; };
class Walk {
  trail = "";
  depth = 0;
  constructor(readonly label: string) {}
  enter(link: Link | undefined, note?: unknown): string {
    if (link === undefined) return this.label + (note === undefined ? "" : "/" + String(note));
    this.trail += ++this.depth + link.name;
    const answer = link.act(this, this.enter.bind(this, link.behind), link);
    this.trail += "-" + this.depth--;
    return answer;
  }
}
const wraps = (open: string, close: string) => new Link(open, (walk, enter) => open + enter() + close);
const twice = new Link("twice", (walk, enter) => enter(1) + "&" + enter("two"));
const stops = new Link("stops", walk => "stopped at " + walk.depth);
const throws = new Link("throws", () => { throw new RangeError("thrown"); });
const catches = new Link("catches", (walk, enter) => { const held = walk.depth; try { return enter(); } catch (error) { walk.depth = held; return "caught " + (error as Error).message; } });
const keeps: Enter[] = [];
const late = new Link("late", (walk, enter) => { keeps.push(enter); return "kept"; });
const other = new Link("other", (walk, enter, link) => enter.call({ label: "no" } as never, link.name) + enter.length + enter.name);
const walks: [string, Link | undefined][] = [["none", chain()], ["one", chain(wraps("(", ")"))], ["three", chain(wraps("a", "b"), wraps("[", "]"), wraps("<", ">"))], ["twice", chain(twice, wraps("{", "}"), twice)], ["stops", chain(wraps("x", "y"), stops, throws)], ["catches", chain(wraps("1", "2"), catches, wraps("3", "4"), throws)], ["late", chain(wraps("l", "r"), late, wraps("q", "q"))], ["other", chain(other, wraps("-", "-"))]];
for (const [label, link] of walks) { const walk = new Walk(label); let answer: string; try { answer = walk.enter(link); } catch (error) { answer = (error as Error).constructor.name; } console.log(answer, walk.trail, walk.depth); }
console.log(keeps.map(enter => enter() + enter()).join(), keeps.length);
const deep = chain(...Array.from({ length: 300 }, (_, i) => (i % 3 ? wraps("", "") : wraps(".", "")))); console.log(new Walk("deep").enter(deep).length);
const mixed = chain(wraps("a", "b"), twice, wraps("c", "d")); let sum = 0; for (let k = 0; k < 500; k++) sum += new Walk("k" + (k % 7)).enter(k & 1 ? mixed : mixed!.behind).length; console.log(sum);
// The bound call is bound once: another method in its place later does not change it, another link behind does not either.
keeps.length = 0; const held = chain(late, wraps("s", "t"))!, changed = new Walk("changed"); changed.enter(held); changed.enter = () => "replaced"; held.behind = wraps("n", "n"); console.log(keeps[0](), changed.enter(held)); held.behind!.behind = held; let turns = 0; const ring = new Walk("ring"), rounds = new Link("round", (walk, enter) => (++turns < 5 ? "r" + enter() : "end")); rounds.behind = rounds; console.log(ring.enter(rounds), ring.trail);
class Counting extends Walk { calls = 0; override enter(link: Link | undefined, note?: unknown): string { this.calls++; return super.enter(link, note); } } const counting = new Counting("counting"); console.log(counting.enter(chain(wraps("u", "v"), twice)), counting.calls);
