// A copy by spread holds the very function objects of its source, whether anybody has read them from the source or not, and they go on capturing the source.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(String).join(" "));
}

interface Kit {
  label: string;
  first: () => number;
  second: (suffix: string) => string;
  own: () => string;
}
let calls = 0;
function kit(label: string): Kit {
  const made = {
    label,
    first: () => ++calls,
    second: suffix => "second" + suffix,
  } as Kit;
  made.own = () => made.label + " owns";
  return made;
}
function relabeled(source: Kit, label: string): Kit {
  return { ...source, label };
}
function plainCopy(source: Kit): Kit {
  return { ...source };
}
function withOtherFirst(source: Kit): Kit {
  return { ...source, first: () => -1 };
}

// Nothing has read the members of the source.
const source = kit("source");
const copy = relabeled(source, "copy");
say("unread", copy.first === source.first, copy.second === source.second, copy.own === source.own, copy.own(), source.own(), copy.label);

// One member has been read.
const partly = kit("partly");
const ownOfPartly = partly.own;
const copyOfPartly = plainCopy(partly);
say("partly read", copyOfPartly.own === ownOfPartly, copyOfPartly.first === partly.first, copyOfPartly.own(), Object.keys(copyOfPartly).join());

// The source changes behind the copy, and the copy behind the source.
const changing = kit("changing");
const early = plainCopy(changing);
changing.label = "changed";
changing.own = () => "replaced";
say("source changes", early.own(), changing.own(), early.own !== changing.own, early.label);
early.first = () => 100;
say("copy changes", early.first(), changing.first() > 0, early.first !== changing.first);

// Copies of copies, many of them, read only at the end.
const chains: Kit[][] = [];
for (let i = 0; i < 50; i++) {
  const root = kit("root" + i);
  const middle = relabeled(root, "middle" + i);
  const leaf = i % 2 ? withOtherFirst(middle) : plainCopy(middle);
  chains.push([root, middle, leaf]);
}
let sameOwn = 0;
let sameFirst = 0;
const owners = new Set<string>();
for (const [root, middle, leaf] of chains) {
  if (root.own === middle.own && middle.own === leaf.own) sameOwn++;
  if (root.first === middle.first && middle.first === leaf.first) sameFirst++;
  owners.add(leaf.own().replace(/\d+/, ""));
}
say("chains", sameOwn, sameFirst, [...owners].join(), chains[1][2].first(), chains[2][2].label, chains[0][0].own !== chains[1][0].own);

console.log(lines.join("\n"));
