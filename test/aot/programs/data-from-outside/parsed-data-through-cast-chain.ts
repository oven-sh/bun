// What is parsed is looked at as one type after another through a chain of casts. Each cast lets the object pass as it is, so every view reads and stores the same object.
interface Link0 { id: number; label: string; next?: Link0 }
interface Link1 { id: number; label: string; next?: Link1; seen?: boolean }
interface Link2 { id: number; label: string; next?: Link2; depth?: number }
interface Link3 { id: number; label: string; next?: Link3; tags?: string[] }
interface Link4 { id: number; label: string; next?: Link4; owner?: Owner }
interface Owner { name: string; links: Link5[] }
interface Link5 { id: number; label: string; next?: Link5 }
type Either = Link5 | { kind: "none"; why: string };
const text = '{"id":1,"label":"a","next":{"id":2,"label":"b","next":{"id":3,"label":"c"}}}';
const first = JSON.parse(text) as Link0;
const second = first as unknown as Link1;
second.seen = true;
const third: Link2 = second as unknown as Link2;
third.depth = 3;
const fourth = third as unknown as Link3;
fourth.tags = ["x", "y"];
const fifth = fourth as unknown as Link4;
const made: Link5 = { id: 9, label: "made" };
fifth.owner = { name: "o", links: [made, fifth.next as unknown as Link5] };
function count(link: { next?: any } | undefined): number { let n = 0; for (let at = link; at; at = at.next) n++; return n; }
function labels(link: Link5 | undefined): string { let out = ""; for (let at = link; at; at = at.next) out += at.label; return out; }
function describe(it: Either): string { return "kind" in it ? it.why : it.label + it.id; }
const all: Either[] = [made, fifth.owner.links[1], { kind: "none", why: "nothing" }];
console.log(count(first), count(third), labels(fifth as unknown as Link5), all.map(describe).join(","));
console.log(JSON.stringify(first), Object.keys(second).join(), fourth.tags.length, third.depth, fifth.owner.links.length);
