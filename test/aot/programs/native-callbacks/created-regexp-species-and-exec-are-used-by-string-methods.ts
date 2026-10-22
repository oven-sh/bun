// Held from creation and methods found through instances: split constructs the subclass with (a RegExp, flags); replace, match, search, test and split call its exec method with a string and read `lastIndex` and `flags`.
let total = 0;

class Pattern extends RegExp {
  constructor(source: string, flags?: string) {
    super(source, flags);
    total += typeof source === "string" ? 1 : (source as any) instanceof RegExp ? 100 : 10000;
  }
  exec(text: string | number): RegExpExecArray | null {
    total += typeof text === "string" ? 100000 : 1000000000;
    return super.exec(String(text));
  }
}

const comma = new Pattern(",", "g");
comma.exec(5);
comma.lastIndex = 0;
const parts = "a,b,c".split(comma);
const replaced = "a,b,c".replace(comma, ";");
const matched = "a,b,c".match(comma);
const found = "a,b,c".search(comma);
const all = [..."a,b,c".matchAll(comma)];
console.log(total, parts.length, replaced, matched?.length, found, all.length, comma.test("x,y"));
