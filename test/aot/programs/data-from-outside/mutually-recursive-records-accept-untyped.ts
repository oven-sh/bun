// Record types that hold each other through arrays, dictionaries, maps and unions. Untyped values enter at each of them in turn, in several functions, so what stays untyped within a type is asked from many starting points that lead to the same records. Objects the program makes itself go the same ways. The output must match plain Bun.
interface Branch { name: string; twigs: Twig[]; parent?: Branch }
interface Twig { length: number; leaves: Leaf[]; branch?: Branch }
interface Leaf { color: string; twig?: Twig; veins: { [name: string]: Vein } }
interface Vein { width: number; next: Vein | null; leaf?: Leaf }
type Either = { kind: "branches"; held: Branch[] } | { kind: "twigs"; held: Twig[]; more: number };
interface Wide { a: number; b: number; c: number; d: number; e: number; f: number; g: number; inner: Wide[] }

function parse(text: string): any {
  return JSON.parse(text);
}

function widthOf(vein: Vein | null): number {
  let sum = 0;
  for (let at = vein; at; at = at.next) sum += at.width;
  return sum;
}

function describeLeaf(leaf: Leaf): string {
  const names = Object.keys(leaf.veins).sort();
  return `${typeof leaf.color}:${leaf.color}[${names.map(name => `${name}=${widthOf(leaf.veins[name])}`).join(",")}]`;
}

function describeTwig(twig: Twig): string {
  return `${twig.length}(${twig.leaves.map(describeLeaf).join(" ")})`;
}

function describeBranch(branch: Branch): string {
  return `${branch.name}<${branch.twigs.map(describeTwig).join("|")}>${branch.parent ? "^" + branch.parent.name : ""}`;
}

function describeEither(either: Either): string {
  return either.kind === "branches" ? either.held.map(describeBranch).join(";") : `${either.more}:${either.held.map(describeTwig).join(";")}`;
}

function sumOfWide(wide: Wide): number {
  return wide.a + wide.b + wide.c + wide.d + wide.e + wide.f + wide.g + wide.inner.reduce((sum, inner) => sum + sumOfWide(inner), 0);
}

const leafText = '{"color":"green","veins":{"x":{"width":1,"next":{"width":2,"next":null}},"y":{"width":5,"next":null}}}';
const twigText = `{"length":2,"leaves":[${leafText},{"color":"brown","veins":{}}]}`;
const branchText = `{"name":"low","twigs":[${twigText}],"parent":{"name":"trunk","twigs":[]}}`;

function enterAtBranch(): void {
  const branch: Branch = parse(branchText);
  console.log(describeBranch(branch));
}

function enterAtTwig(): void {
  const twig: Twig = parse(twigText);
  console.log(describeTwig(twig));
  const twigs: Twig[] = parse(`[${twigText},${twigText}]`);
  console.log(twigs.map(describeTwig).join(" & "));
}

function enterAtLeaf(): void {
  const leaves = new Map<string, Leaf>();
  leaves.set("parsed", parse(leafText));
  leaves.set("made", { color: "red", veins: { z: { width: 3, next: null } } });
  for (const [name, leaf] of leaves) console.log(name, describeLeaf(leaf));
}

function enterAtVein(): void {
  const veins: { [name: string]: Vein } = parse('{"p":{"width":4,"next":{"width":4,"next":{"width":4,"next":null}}}}');
  console.log(widthOf(veins.p));
  const own: Vein = { width: 1, next: null };
  own.next = parse('{"width":10,"next":null}');
  console.log(widthOf(own));
}

function enterAtEither(): void {
  const first: Either = parse(`{"kind":"branches","held":[${branchText}]}`);
  const second: Either = parse(`{"kind":"twigs","held":[${twigText}],"more":9}`);
  const third: Either = { kind: "twigs", held: [{ length: 1, leaves: [] }], more: 1 };
  for (const either of [first, second, third]) console.log(describeEither(either));
}

function enterAtWide(): void {
  const wide: Wide = parse('{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"inner":[{"a":1,"b":1,"c":1,"d":1,"e":1,"f":1,"g":1,"inner":[]}]}');
  console.log(sumOfWide(wide));
  const list: Wide[] = [wide, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 1, inner: [] }];
  console.log(list.map(sumOfWide).join(","));
}

function madeHere(): void {
  const trunk: Branch = { name: "trunk", twigs: [] };
  const leaf: Leaf = { color: "gold", veins: {} };
  const twig: Twig = { length: 3, leaves: [leaf], branch: trunk };
  leaf.twig = twig;
  leaf.veins.only = { width: 8, next: null, leaf };
  trunk.twigs.push(twig);
  const high: Branch = { name: "high", twigs: [twig], parent: trunk };
  console.log(describeBranch(trunk), describeBranch(high), leaf.veins.only.leaf === leaf, twig.branch === trunk);
}

enterAtBranch();
enterAtTwig();
enterAtLeaf();
enterAtVein();
enterAtEither();
enterAtWide();
madeHere();
enterAtVein();
enterAtBranch();
