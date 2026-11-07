// Rings of one, two, three and forty records with long texts, a ring through lists, a ring whose long texts are in records beside it, and two rings with texts of 16-bit characters, each in a record that has a toJSON beside it.
// JSON.stringify prints its error and how often toJSON ran. A ring is found after a few hundred levels: the long texts are appended some thousand times in all, not half a million times.
// COUNT: operation:operationAOTJSONAppendString <= 5000
// COUNT: operations <= 8000
interface Link {
  text: string;
  next: Link | null;
}
function ringOf(count: number): Link {
  const first: Link = { text: "a".repeat(40000), next: null };
  let last = first;
  for (let index = 1; index < count; index++) {
    last.next = { text: String(index % 10).repeat(40000), next: null };
    last = last.next;
  }
  last.next = first;
  return first;
}

interface Branch {
  text: string;
  below: Branch[];
}
const trunk: Branch = { text: "t".repeat(40000), below: [] };
trunk.below.push({ text: "leaf", below: [] }, { text: "u".repeat(40000), below: [{ text: "twig", below: [] }, trunk] });

interface Note {
  text: string;
  size: number;
}
interface LinkWithNotes {
  before: Note;
  next: LinkWithNotes | null;
  after: Note;
}
const noted: LinkWithNotes = {
  before: { text: "b".repeat(40000), size: 1 },
  next: null,
  after: { text: "c".repeat(40000), size: 2 },
};
noted.next = { before: { text: "d".repeat(40000), size: 3 }, next: noted, after: { text: "e".repeat(40000), size: 4 } };

let calls = 0;
const counter: unknown = {
  toJSON() {
    return ++calls;
  },
};

for (const value of [1, 2, 3, 40].map((count): { first: unknown; chain: Link } => ({
  first: counter,
  chain: ringOf(count),
}))) {
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error), calls);
  }
}
for (const value of [{ first: counter, tree: trunk }] as { first: unknown; tree: Branch }[]) {
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error), calls);
  }
}
for (const value of [{ first: counter, chains: [noted] }] as { first: unknown; chains: LinkWithNotes[] }[]) {
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error), calls);
  }
}

const wide: Link = { text: "\u4e00".repeat(40000), next: null };
wide.next = { text: "\u4e01".repeat(40000), next: wide };
for (const value of [{ first: counter, chain: wide }] as { first: unknown; chain: Link }[]) {
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error), calls);
  }
}

interface LinkWithMore {
  text: string;
  more: unknown;
  next: LinkWithMore | null;
}
const wideWithMore: LinkWithMore = { text: "\u4e02".repeat(40000), more: 1, next: null };
wideWithMore.next = { text: "\u4e03".repeat(40000), more: "two", next: wideWithMore };
for (const value of [{ first: counter, chain: wideWithMore }] as { first: unknown; chain: LinkWithMore }[]) {
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error), calls);
  }
}

const straight: Link = ringOf(300);
let end = straight;
while (end.next !== straight) end = end.next!;
end.next = null;
for (const value of [{ first: counter, chain: straight }] as { first: unknown; chain: Link }[])
  console.log(JSON.stringify(value).length, calls);
