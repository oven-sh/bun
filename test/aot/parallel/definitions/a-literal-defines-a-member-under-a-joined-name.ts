// A member of a literal whose written key is a template: the key is made once, before the value, and the members stand in the order written.
const kinds: Record<string, string[]> = { json: ["a/json"], form: ["a/form"], text: ["a/text"] };
const limits: Record<string, number> = { jsonLimit: 1, formLimit: 2, textLimit: 3 };
const log: string[] = [];

function optionsOf(kind: string, strict: boolean) {
  return {
    raw: true,
    strict: kind === "json" ? strict : undefined,
    [`${kind}Types`]: kinds[kind],
    limit: limits[`${kind}Limit`],
    encoding: "utf-8",
  };
}

function noisy(name: string) {
  return {
    toString() {
      log.push("key " + name);
      return name;
    },
  };
}

function valueOf(name: string) {
  log.push("value " + name);
  return name.length;
}

function inOrder(first: unknown, second: unknown) {
  return { [`${first}One`]: valueOf("one"), [`${second}Two`]: valueOf("two"), [`${first}One`]: valueOf("again") };
}

function underNumbers(index: number) {
  return { [`${index}`]: "text of a number", [`${index}${index}`]: "two digits", [`-${index}`]: "negative" };
}

function underOddNames(part: string) {
  return { [`__${part}__`]: 1, [`${part}`]: 2, [`${part}${""}`]: 3 };
}

function classOf(part: string) {
  return class {
    static [`made${part}Static`]() {
      return 1;
    }
    get [`made${part}Getter`]() {
      return 2;
    }
    [`made${part}Method`]() {
      return 3;
    }
  };
}

for (let turn = 0; turn < 3; turn++) {
  for (const kind of ["json", "form", "text", "json"]) console.log(JSON.stringify(optionsOf(kind, turn === 1)), Object.keys(optionsOf(kind, false)).join());
}
console.log(JSON.stringify(inOrder(noisy("a"), noisy("b"))), log.join(" | "));
console.log(JSON.stringify(underNumbers(4)), Object.keys(underNumbers(7)).join());
const odd = underOddNames("proto");
console.log(Object.keys(odd).join(), Object.getPrototypeOf(odd) === Object.prototype, JSON.stringify(odd));
const Holder = classOf("Here") as any;
const holder = new Holder();
console.log(Holder.madeHereStatic(), holder.madeHereGetter, holder.madeHereMethod(), holder.madeHereMethod.name, Object.getOwnPropertyNames(Holder.prototype).join());
const frozen = Object.freeze(optionsOf("form", true));
console.log(Object.getOwnPropertyDescriptor(frozen, "formTypes")!.enumerable, "formTypes" in frozen, "jsonTypes" in frozen);
