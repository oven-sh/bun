// JSON.parse of objects with 0 to 200 properties, on both sides of every limit of inline and out-of-line property storage: keys, values, and a property added and deleted afterwards do not depend on which parser created the object.
const sizes = [0, 1, 6, 7, 8, 48, 49, 61, 62, 63, 64, 65, 200];
const callsPerText = 24;
const untyped: any = { parse: JSON.parse };
const indexLikeNames = ["2", "4294967294", "0", "4294967295", "-1", "01"];

function valueText(index: number): string {
  switch (index % 8) {
    case 0:
      return String(index * 100000007);
    case 1:
      return "-" + index + ".5";
    case 2:
      return '"s' + index + '"';
    case 3:
      return index % 16 === 3 ? "true" : "false";
    case 4:
      return "null";
    case 5:
      return "[" + index + ',"e",[]]';
    case 6:
      return '{"n":' + index + ',"m":{}}';
    default:
      return index % 16 === 7 ? "-0" : index + "e20";
  }
}

function plainMember(index: number): string {
  return '"k' + index + '":' + valueText(index);
}

function memberWithDuplicate(index: number): string {
  if (index % 3) return plainMember(index);
  const earlierName = (index % 6 ? '"\\u006b' : '"k') + (index >> 1) + '"';
  return plainMember(index) + "," + earlierName + ':"repeated after k' + index + '"';
}

function indexLikeMember(size: number, index: number): string {
  if (index % 4 !== 1) return plainMember(index);
  return '"' + (indexLikeNames[index >> 2] ?? String(1000 + size - index)) + '":' + valueText(index);
}

function spacedMember(index: number): string {
  return '\n\t"k' + index + '" :\r ' + valueText(index) + " ";
}

function wideMember(index: number): string {
  return index % 3 === 1 ? '"k' + index + '中":"é中' + index + '"' : plainMember(index);
}

function objectText(size: number, memberText: (index: number) => string = plainMember): string {
  const members: string[] = [];
  for (let index = 0; index < size; index++) members.push(memberText(index));
  return "{" + members.join(",") + "}";
}

function pairText(object: string): string {
  return "[" + object + "," + object + "]";
}

function toWideString(text: string): string {
  return ("中" + text).slice(1);
}

function identityReviver(key: string, value: any): any {
  return value;
}

function sourceTextReviver(key: string, value: any, context?: any): any {
  if (key === "k2") return undefined;
  if (typeof value === "number") return context?.source ?? "no source text for " + value;
  return value;
}

function describe(value: any): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value !== "object" || value === null) return Object.is(value, -0) ? "-0" : String(value);
  if (Array.isArray(value)) return "[" + value.map(element => describe(element)).join(",") + "]";
  return (
    "{" +
    Object.keys(value)
      .map(key => key + "=" + describe(value[key]))
      .join(",") +
    "}"
  );
}

function mutationReport(value: any): string {
  const keys = Object.keys(value);
  const enumerated: string[] = [];
  for (const name in value) enumerated.push(name);
  const hasOnlyPlainDataProperties = Object.values(Object.getOwnPropertyDescriptors(value)).every(
    descriptor => descriptor.writable && descriptor.enumerable && descriptor.configurable,
  );
  const removed = keys.length ? keys[keys.length >> 1] : "added";
  const lines = [
    keys.length + " keys",
    Reflect.ownKeys(value).length + " own keys",
    "for-in agrees: " + (enumerated.join() === keys.join()),
    "only plain data properties: " + hasOnlyPlainDataProperties,
    "extensible: " + Object.isExtensible(value),
    "ordinary prototype: " + (Object.getPrototypeOf(value) === Object.prototype),
    "parsed: " + describe(value),
  ];
  value.added = "new";
  lines.push("added: " + describe(value));
  const wasDeleted = delete value[removed];
  lines.push("deleted " + removed + " (" + wasDeleted + "): " + describe(value));
  value[removed] = "again";
  lines.push("stored " + removed + " again: " + describe(value));
  return lines.join("\n  ");
}

function checkParsedObjects(label: string, text: string, parse: (text: string) => any[], expected = ""): string {
  let agreeing = 0;
  for (let call = 0; call < callsPerText; call++) {
    for (const value of parse(text)) {
      const actual = mutationReport(value);
      if (!expected) {
        expected = actual;
        console.log(label + ": " + actual);
      } else if (actual === expected) agreeing++;
      else console.log(label + ", call " + call + " differs: " + actual);
    }
  }
  console.log(label + ": " + agreeing + " objects agree");
  return expected;
}

function errorMessage(parse: () => unknown): string {
  try {
    parse();
    return "no error";
  } catch (error: any) {
    return error.name + ": " + error.message;
  }
}

function malformedObjectTexts(size: number): [string, string][] {
  const open = objectText(size).slice(0, -1);
  const beforeLastMember = size ? open + "," : open;
  return [
    ["no closing brace", open],
    ["comma before the closing brace", open + ",}"],
    ["second closing brace", open + "}}"],
    ["no colon", beforeLastMember + '"last" 1}'],
    ["no value", beforeLastMember + '"last":}'],
    ["misspelled null", beforeLastMember + '"last":nul}'],
    ["unquoted name", beforeLastMember + "last:1}"],
    ["single-quoted name", beforeLastMember + "'last':1}"],
    ["unterminated string", beforeLastMember + '"last":"open}'],
    ["line break in a string", beforeLastMember + '"last":"a\nb"}'],
    ["unknown escape", beforeLastMember + '"last":"\\x41"}'],
    ["leading zero", beforeLastMember + '"last":01}'],
  ];
}

for (const size of sizes) {
  const label = size + " properties, ";
  const middle = size >> 1;
  const object = objectText(size);
  const pair = pairText(object);
  const spaced = objectText(size, spacedMember);
  const duplicates = pairText(objectText(size, memberWithDuplicate));

  const expected = checkParsedObjects(label + "twice in one text", pair, text => JSON.parse(text));
  checkParsedObjects(label + "alone", object, text => [JSON.parse(text)], expected);
  checkParsedObjects(label + "JSON.parse called as a value", pair, text => untyped.parse(text), expected);
  checkParsedObjects(label + "whitespace", "[ " + spaced + " ,\n" + spaced + "\t]", text => JSON.parse(text), expected);
  checkParsedObjects(label + "16-bit source", toWideString(pair), text => JSON.parse(text), expected);
  checkParsedObjects(label + "identity reviver", pair, text => JSON.parse(text, identityReviver), expected);
  checkParsedObjects(
    label + "nested in arrays and objects",
    '{"list":[[' + object + "],[[0," + object + ']]],"last":' + object + "}",
    text => {
      const parsed = JSON.parse(text);
      return [parsed.list[0][0], parsed.list[1][0][1], parsed.last];
    },
    expected,
  );

  checkParsedObjects(label + "duplicate names", duplicates, text => JSON.parse(text));
  checkParsedObjects(
    label + "index-like names",
    pairText(objectText(size, index => indexLikeMember(size, index))),
    text => JSON.parse(text),
  );
  checkParsedObjects(
    label + "__proto__",
    pairText(objectText(size, index => (index === middle ? '"__proto__":{"polluted":true}' : plainMember(index)))),
    text => JSON.parse(text),
  );
  checkParsedObjects(label + "16-bit names and values", pairText(objectText(size, wideMember)), text =>
    JSON.parse(text),
  );
  checkParsedObjects(label + "source text reviver", pair, text => JSON.parse(text, sourceTextReviver));
  checkParsedObjects(label + "duplicate names, source text reviver", duplicates, text =>
    JSON.parse(text, sourceTextReviver),
  );
}

for (const size of sizes) {
  const object = objectText(size);
  for (const [label, malformed] of malformedObjectTexts(size)) {
    const text = "[" + object + "," + malformed + "]";
    const messages = [
      errorMessage(() => JSON.parse(text)),
      errorMessage(() => JSON.parse(malformed)),
      errorMessage(() => untyped.parse(text)),
      errorMessage(() => JSON.parse(text, identityReviver)),
      errorMessage(() => JSON.parse(toWideString(text))),
    ];
    console.log(size + " properties, " + label + ": " + messages.join(" | "));
  }
  console.log(size + " properties, well formed again: " + describe(JSON.parse(pairText(object))[1]));
}

console.log("Object.prototype has polluted: " + ("polluted" in untyped));

export {};
