// an object of a union is made without its tag, which is stored later, and stored over once more: whoever tests the tag in between finds undefined
// Under: --aot-testing=CheckProofsAtRunTime: what arrives at the field of the tag
class Leaf {
  tag: number | undefined;
  text = "text";
}
class Pair {
  tag: number | undefined;
  left = "left";
}

function show(n: Leaf | Pair): unknown {
  switch (n.tag) {
    case 1:
      return (n as Leaf).text;
    case 2:
      return (n as Pair).left;
  }
  return "no tag";
}

function deed(n: Leaf | Pair, tag: number) {
  n.tag = tag;
}

const leaf = new Leaf();
const pair = new Pair();
console.log(String(show(leaf)), String(show(pair)));
deed(leaf, 1);
deed(pair, 2);
console.log(String(show(leaf)), String(show(pair)));
let seen = "";
for (let i = 0; i < 300; i++) seen = String(show(i % 2 ? leaf : pair));
console.log(seen);
deed(leaf, 2);
console.log(String(show(leaf)));
for (let i = 0; i < 3; i++) {
  deed(pair, i);
  console.log(String(show(pair)));
}
