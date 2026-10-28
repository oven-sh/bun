// Programs in which a loop carries an object of a union that a tag tells apart. One turn in many puts an object of another member in its place, and every turn reads the field of the member
// that the tag names.
//
// A program is one kind of tag: its functions share the members of one union. Each combination of a loop, a way to tell the members apart and what else a turn does is a function of its own,
// with a helper of its own, so that each is compiled for what it alone sees.
export const tags: [name: string, first: string, second: string, third: string][] = [
  ["one and two", "1", "2", "3"],
  ["zero and one", "0", "1", "2"],
  ["numbers of both signs", "-1", "1", "0"],
  ["numbers far apart", "7", "70000", "4000000000"],
  ["fractions", "0.5", "1.5", "2.5"],
  ["texts", '"first"', '"second"', '"third"'],
  ["the empty text and another", '""', '"x"', '"xx"'],
  ["booleans", "false", "true", "null"],
  ["null and undefined", "null", "undefined", "0"],
  ["a number and a text", "1", '"1"', "true"],
  ["big integers", "1n", "2n", "3n"],
  ["members of an enumeration", "Kind.First", "Kind.Second", "Kind.Third"],
  ["members of an enumeration of texts", "Word.First", "Word.Second", "Word.Third"],
];

// «turn» is the body of a turn, which reads `i` once.
const loops: [name: string, text: string][] = [
  ["for", "for (let i = 0; i < 40; i++) { «turn» }"],
  ["while", "let n = 0; while (n < 40) { const i = n++; «turn» }"],
  ["doWhile", "let n = 0; do { const i = n; «turn» } while (++n < 40);"],
  ["downwards", "for (let n = 39; n >= 0; n--) { const i = 39 - n; «turn» }"],
  ["forOf", "for (const i of places) { «turn» }"],
  [
    "inner",
    "for (let outer = 0; outer < 4; outer++) for (let n = 0; n < 10; n++) { const i = outer * 10 + n; «turn» }",
  ],
  ["endless", "for (let i = 0; ; i++) { if (i >= 40) break; «turn» }"],
];

// What is read from `box`, which holds the first member or the second.
const reads: [name: string, text: string][] = [
  ["isSecond", "box.kind === «second» ? box.held : box.other"],
  ["isNotSecond", "box.kind !== «second» ? box.other : box.held"],
  ["isFirst", "box.kind === «first» ? box.other : box.held"],
  ["isNotFirst", "box.kind !== «first» ? box.held : box.other"],
  ["switch", "((): V => { switch (box.kind) { case «first»: return box.other; case «second»: return box.held; } })()"],
  ["hasField", '"held" in box ? box.held : box.other'],
];

// What a turn does with what it has read. «use» is the helper of the function.
const uses: [name: string, helper: string, turn: string][] = [
  ["comparedWithWhatAVariableOfTheModuleChooses", "const w = other(); return v != w;", "out = «use»(«read»);"],
  ["addedToAVariableOfTheModule", "total += v; return total;", "out = «use»(«read»);"],
  ["addedToAVariableOfTheFunction", "return v + 1;", "sum += «use»(«read»); out = sum;"],
  ["addedByAClosure", "return v + 1;", "const add = () => (sum += «use»(«read»)); out = add();"],
];

// What is put in place of the first member, and when.
const replacements: [name: string, union: string, text: string][] = [
  ["once", "First | Second", "if (i === at) box = { kind: «second», held: late() };"],
  [
    "andBack",
    "First | Second",
    "if (i === at) box = { kind: «second», held: late() }; else if (i === at + 5) box = { kind: «first», other: 4 };",
  ],
  ["byAFunction", "First | Second", "if (i === at) box = made(i);"],
];

const late = "new Float64Array(new BigUint64Array([0xfffe000000000001n]).buffer)[0]";

export function program(tag: (typeof tags)[number]): { file: string; text: string } {
  const [, first, second, third] = tag;
  const fill = (text: string) =>
    text.replaceAll("«first»", first).replaceAll("«second»", second).replaceAll("«third»", third);
  const lines = [
    "enum Kind { First, Second, Third }",
    'enum Word { First = "first", Second = "second", Third = "third" }',
    "let flips = 0, total = 0;",
    `const late = () => ${late}, early = () => -3;`,
    "type V = ReturnType<typeof early> | ReturnType<typeof late>;",
    `function other() { return flips++ & 1 ? ${late} : -3; }`,
    fill("type First = { kind: «first»; other: V };"),
    fill("type Second = { kind: «second»; held: V };"),
    fill("type Third = { kind: «third»; last: V };"),
    fill(
      "function made(i: number): First | Second { return i & 1 ? { kind: «second», held: late() } : { kind: «first», other: i }; }",
    ),
    "const places = Array.from({ length: 40 }, (_, i) => i);",
    'const say = (label: string, walk: (at: number) => unknown) => { const answers: string[] = []; for (let n = 0; n < 6; n++) answers.push(String(walk(n % 2 ? 27 : 1000))); console.log(label, answers.join(" "), flips, total); };',
  ];
  for (const [loop, loopText] of loops)
    for (const [read, readText] of reads)
      for (const [use, helper, turn] of uses)
        for (const [replacement, union, replacementText] of replacements) {
          const name = `${loop}_${read}_${use}_${replacement}`;
          const body = `${replacementText} ${turn.replace("«use»", `use_${name}`).replace("«read»", readText)}`;
          lines.push(
            `function use_${name}(v: V) { ${helper} }`,
            fill(
              `function walk_${name}(at: number) { let box: ${union} = { kind: «first», other: -3 }, out, sum = 0; ${loopText.replace("«turn»", body)} return out; }`,
            ),
            `function attempt_${name}(at: number) { return walk_${name}(at); }`,
            `say(${JSON.stringify(name)}, attempt_${name});`,
          );
        }
  // Three members, of which the loop meets the third in a later turn.
  for (const [loop, loopText] of loops) {
    const name = `${loop}_threeMembers`;
    const body = fill(
      `if (i === at) box = { kind: «second», held: late() }; else if (i === at + 5) box = { kind: «third», last: late() }; switch (box.kind) { case «first»: out = use_${name}(box.other); break; case «second»: out = use_${name}(box.held); break; default: out = use_${name}(box.last); }`,
    );
    lines.push(
      `function use_${name}(v: V) { const w = other(); return v != w; }`,
      fill(
        `function walk_${name}(at: number) { let box: First | Second | Third = { kind: «first», other: -3 }, out; ${loopText.replace("«turn»", body)} return out; }`,
      ),
      `function attempt_${name}(at: number) { return walk_${name}(at); }`,
      `say(${JSON.stringify(name)}, attempt_${name});`,
    );
  }
  return { file: "main.ts", text: lines.join("\n") + "\n" };
}
