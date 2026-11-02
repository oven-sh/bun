// A chain of records with long texts ends in its own first record: alone, with a member of unknown type beside the text, and inside a record that has a toJSON beside it.
// JSON.stringify prints its error and how often toJSON ran.
interface Link {
  text: string;
  next: Link | null;
}
const link: Link = { text: "x".repeat(40000), next: null };
link.next = link;

interface LinkWithMore {
  text: string;
  more: unknown;
  next: LinkWithMore | null;
}
const linkWithMore: LinkWithMore = { text: "y".repeat(40000), more: 1, next: null };
linkWithMore.next = { text: "z".repeat(40000), more: "two", next: linkWithMore };

let calls = 0;
const around: { first: unknown; chain: Link; chains: Link[] } = {
  first: {
    toJSON() {
      return ++calls;
    },
  },
  chain: { text: "short", next: null },
  chains: [link],
};

for (const value of [link]) {
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error));
  }
}
for (const value of [linkWithMore]) {
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error));
  }
}
for (const value of [around]) {
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error), calls);
  }
  value.chain = link;
  try {
    console.log(JSON.stringify(value).length);
  } catch (error) {
    console.log(String(error), calls);
  }
}
