// Bytes of the source that are not UTF-8, in string literals, templates, the cooked strings of a tagged template and property names.
function describe(text: string): string {
  const codePoints: string[] = [];
  for (const character of text) codePoints.push(character.codePointAt(0)!.toString(16));
  return text.length + ":" + codePoints.join(".");
}

const literals: string[] = [
  "aÿb",
  'é',
  "€",
  "¿ø",
  "â‚x",
  "À€",
  "Ã(",
  "õ€€€",
  "ðŸ˜",
  "í €",
  "í ½í¸€",
  "ÿ\u00e9\ud800é\n",
  "Ã©ÿæ—¥",
];
for (const literal of literals) console.log(describe(literal));

const count = 2;
const cookedOf = (strings: TemplateStringsArray, ..._values: unknown[]): string => strings.join("|");
console.log(describe(`aÿb`), describe(`é${count}ÿ${count}€`), describe(cookedOf`ÿ\né${count}í €`));

const record = { "kÿ": 1, "é": 2 };
console.log(Object.keys(record).map(describe).join(), record["kÿ"], record["é"]);

class Named {
  "fÿ" = 3;
  "mé"() {
    return 4;
  }
}
const named = new Named();
console.log(Object.keys(named).map(describe).join(), named["fÿ"], named["mé"](), describe(named["mé"].name));

const high: string = "ÿ";
const lead: string = "é";
console.log(high === "\u00ff", high === "\ufffd", lead === "\u00e9", lead === "\ufffd", high === lead);
console.log("ÿÿ".length, "éx".indexOf("x"), "ÿ" + "é" === high + lead, describe("í ½" + "í¸€"));

function rank(text: string): number {
  switch (text) {
    case "rÿ":
      return 1;
    case "sé":
      return 2;
    default:
      return 0;
  }
}
const candidates = ["r\u00ff", "r\ufffd", "s\u00e9", "s\ufffd", "r" + String.fromCharCode(0xff), "s" + String.fromCharCode(0xfffd)];
console.log(candidates.map(rank).join());
