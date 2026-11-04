// A string is held against four or more literals at once: neighbors, a few within 32 and within 64 of each other, some farther apart, out of a variable and out of a field.

// prettier-ignore
type Word =
  | "w000" | "w001" | "w002" | "w003" | "w004" | "w005" | "w006" | "w007" | "w008" | "w009"
  | "w010" | "w011" | "w012" | "w013" | "w014" | "w015" | "w016" | "w017" | "w018" | "w019"
  | "w020" | "w021" | "w022" | "w023" | "w024" | "w025" | "w026" | "w027" | "w028" | "w029"
  | "w030" | "w031" | "w032" | "w033" | "w034" | "w035" | "w036" | "w037" | "w038" | "w039"
  | "w040" | "w041" | "w042" | "w043" | "w044" | "w045" | "w046" | "w047" | "w048" | "w049"
  | "w050" | "w051" | "w052" | "w053" | "w054" | "w055" | "w056" | "w057" | "w058" | "w059"
  | "w060" | "w061" | "w062" | "w063" | "w064" | "w065" | "w066" | "w067" | "w068" | "w069"
  | "w070" | "w071" | "w072" | "w073" | "w074" | "w075" | "w076" | "w077" | "w078" | "w079"
  | "w080" | "w081" | "w082" | "w083" | "w084" | "w085" | "w086" | "w087" | "w088" | "w089"
  | "w090" | "w091" | "w092" | "w093" | "w094" | "w095" | "w096" | "w097" | "w098" | "w099"
  | "w100" | "w101" | "w102" | "w103" | "w104" | "w105" | "w106" | "w107" | "w108" | "w109"
  | "w110" | "w111" | "w112" | "w113" | "w114" | "w115" | "w116" | "w117" | "w118" | "w119"
  | "w120" | "w121" | "w122" | "w123" | "w124" | "w125" | "w126" | "w127" | "w128" | "w129"
  | "w130" | "w131" | "w132" | "w133" | "w134" | "w135" | "w136" | "w137" | "w138" | "w139";

type Neighbors = "w010" | "w011" | "w012" | "w013" | "w014";
type Within32 = "w020" | "w023" | "w029" | "w031" | "w047";
type Within64 = "w001" | "w017" | "w033" | "w049" | "w064";
type Apart = "w000" | "w002" | "w003" | "w005" | "w066" | "w070" | "w071" | "w073" | "w074" | "w139";
type WithEmpty = "" | "w000" | "w001" | "w003";
type Kind = "add" | "sub" | "mul" | "div" | "neg" | "not" | "call";

function amongNeighbors(word: Neighbors): string {
  if (word === "w010") return "a";
  if (word === "w011") return "b";
  if (word === "w012") return "c";
  if (word === "w013") return "d";
  if (word === "w014") return "e";
  return "none: " + String(word);
}

function amongWithin32(word: Within32): string {
  if (word === "w020") return "a";
  if (word === "w023") return "b";
  if (word === "w029") return "c";
  if (word === "w031") return "d";
  if (word === "w047") return "e";
  return "none: " + String(word);
}

function amongWithin64(word: Within64): string {
  if (word === "w001") return "a";
  if (word === "w017") return "b";
  if (word === "w033") return "c";
  if (word === "w049") return "d";
  if (word === "w064") return "e";
  return "none: " + String(word);
}

function amongApart(word: Apart): string {
  if (word === "w000") return "a";
  if (word === "w002") return "b";
  if (word === "w003") return "c";
  if (word === "w005") return "d";
  if (word === "w066") return "e";
  if (word === "w070") return "f";
  if (word === "w071") return "g";
  if (word === "w073") return "h";
  if (word === "w074") return "i";
  if (word === "w139") return "j";
  return "none: " + String(word);
}

function amongWithEmpty(word: WithEmpty): string {
  if (word === "") return "a";
  if (word === "w000") return "b";
  if (word === "w001") return "c";
  if (word === "w003") return "d";
  return "none: " + String(word);
}

function isOperator(kind: Kind): kind is "add" | "sub" | "mul" | "div" {
  return kind === "add" || kind === "sub" || kind === "mul" || kind === "div";
}

class Box {
  word: Word;
  other: Word | null | undefined;
  constructor(word: Word, other: Word | null | undefined) {
    this.word = word;
    this.other = other;
  }
}

const texts: string[] = [];
for (let i = 0; i < 150; i++) texts.push("w" + String(i).padStart(3, "0"));
texts.push("", "w", "w01", "w0100", "W010", "w010 ", "x010", "undefined", "null", "add", "call");

function report(name: string, among: (text: string) => string) {
  const found: string[] = [];
  for (const text of texts) {
    const answer = among(text);
    if (answer !== "none: " + text) found.push(JSON.stringify(text) + "=" + answer);
  }
  console.log(name, found.join(" "));
}

report("neighbors", text => amongNeighbors(text as Neighbors));
report("within 32", text => amongWithin32(text as Within32));
report("within 64", text => amongWithin64(text as Within64));
report("apart", text => amongApart(text as Apart));
report("with empty", text => amongWithEmpty(text as WithEmpty));
report("operators", text => (isOperator(text as Kind) ? "yes" : "none: " + text));

const boxes: Box[] = [];
for (let i = 0; i < texts.length; i++) {
  const other = i % 3 === 0 ? null : i % 3 === 1 ? undefined : (texts[texts.length - 1 - i] as Word);
  boxes.push(new Box(texts[i] as Word, other));
}

function reportFields(name: string, among: (box: Box) => string, amongOthers: (box: Box) => string) {
  const found: string[] = [];
  for (const box of boxes) {
    const answer = among(box);
    if (answer !== "none: " + box.word) found.push(JSON.stringify(box.word) + "=" + answer);
    const otherAnswer = amongOthers(box);
    if (otherAnswer !== "none: " + box.other) found.push(JSON.stringify(box.other) + "~" + otherAnswer);
  }
  console.log(name, found.join(" "));
}

reportFields(
  "neighbors in fields",
  box => amongNeighbors(box.word as Neighbors),
  box => amongNeighbors(box.other as Neighbors),
);
reportFields(
  "within 32 in fields",
  box => amongWithin32(box.word as Within32),
  box => amongWithin32(box.other as Within32),
);
reportFields(
  "within 64 in fields",
  box => amongWithin64(box.word as Within64),
  box => amongWithin64(box.other as Within64),
);
reportFields(
  "apart in fields",
  box => amongApart(box.word as Apart),
  box => amongApart(box.other as Apart),
);
console.log(boxes.map(box => box.word + "|" + box.other).join(" "));
