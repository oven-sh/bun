// JSON.parse(text) and `await response.json()` that go straight into a typed position: an annotated variable, an assertion, an argument, a return, a field, and an awaited body. Each position has a record type of its own, so a parser for each type shows that the compiler found the type at each position and builds the object as that type. Text that fits is read through its type, also after untyped code has changed the object. Text that does not fit and text that is no JSON give what plain Bun gives.
// STATISTIC: TypedResultsSelected >= 6
// STATISTIC: ParsersCreated >= 6
type InVariable = { variableId: number; variableName: string };
type Asserted = { assertedId: number; assertedName: string };
type Argument = { argumentId: number; argumentName: string };
type Returned = { returnedId: number; returnedName: string };
type InField = { fieldId: number; fieldName: string };
type InBody = { bodyId: number; bodyName: string };
type Change = (value: any, prefix: string) => void;

function describe(value: unknown): string {
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "undefined";
  const isArray = Array.isArray(value);
  const members = Reflect.ownKeys(value).map(key => String(key) + "=" + describe((value as any)[key]));
  return (isArray ? "[" : "{") + members.join() + (isArray ? "]" : "}") + (Object.getPrototypeOf(value) === (isArray ? Array.prototype : Object.prototype) ? "" : " ANOTHER PROTOTYPE");
}

function intoVariable(text: string, change: Change): string {
  const value: InVariable = JSON.parse(text);
  change(value, "variable");
  return value.variableId + " " + value.variableName + " " + describe(value);
}

function asserted(text: string, change: Change): string {
  const value = JSON.parse(text) as Asserted;
  change(value, "asserted");
  return value.assertedId + " " + value.assertedName + " " + describe(value);
}

function takeArgument(value: Argument, change: Change): string {
  change(value, "argument");
  return value.argumentId + " " + value.argumentName + " " + describe(value);
}
function intoArgument(text: string, change: Change): string {
  return takeArgument(JSON.parse(text), change);
}

function returned(text: string): Returned {
  return JSON.parse(text);
}
function fromReturn(text: string, change: Change): string {
  const value = returned(text);
  change(value, "returned");
  return value.returnedId + " " + value.returnedName + " " + describe(value);
}

class Holder {
  field: InField = { fieldId: 0, fieldName: "none" };
}
function intoField(text: string, change: Change): string {
  const holder = new Holder();
  holder.field = JSON.parse(text);
  change(holder.field, "field");
  return holder.field.fieldId + " " + holder.field.fieldName + " " + describe(holder.field);
}

async function awaitedBody(response: Response, change: Change): Promise<string> {
  const value: InBody = await response.json();
  change(value, "body");
  return value.bodyId + " " + value.bodyName + " " + describe(value);
}

function textsFor(prefix: string): string[] {
  const id = JSON.stringify(prefix + "Id");
  const name = JSON.stringify(prefix + "Name");
  return [
    `{${id}:1,${name}:"one"}`,
    `{${name}:"two",${id}:2}`,
    ` {\n\t${id} : 3 ,\r\n\t${name} : "three"\n} `,
    `{${id}:-0,${name}:""}`,
    `{${id}:1.5e3,${name}:"\\u00e9\\n\\"quoted\\""}`,
    `{${id}:4,${name}:"four","extra":[true,null,{"deep":1}]}`,
    `{"first":0,${id}:5,${name}:"five"}`,
    `{${id}:6}`,
    `{${name}:"seven"}`,
    `{${id}:"eight",${name}:8}`,
    `{${id}:null,${name}:null}`,
    `{${id}:{"nested":9},${name}:["nine"]}`,
    `{${id}:10,${name}:"ten",${id}:11}`,
    `{"__proto__":{"inherited":1},${id}:12,${name}:"twelve"}`,
    `{}`,
    `[]`,
    `[{${id}:13,${name}:"thirteen"}]`,
    `null`,
    `true`,
    `14`,
    `"text"`,
    ``,
    ` `,
    `{`,
    `{${id}:1,}`,
    `{${id}:1}}`,
    `{${id}:01}`,
    `{${id}:1 ${name}:"one"}`,
    `{'single':1}`,
    `undefined`,
  ];
}

const nothing: Change = () => {};
const changes: [string, Change][] = [
  ["a value of another kind", (value, prefix) => void (value[prefix + "Id"] = "text")],
  ["a member deleted", (value, prefix) => void delete value[prefix + "Name"]],
  ["a member deleted and added again", (value, prefix) => void (delete value[prefix + "Id"], (value[prefix + "Id"] = 20))],
  ["a member added", value => void (value.added = true)],
  ["an accessor", (value, prefix) => void Object.defineProperty(value, prefix + "Id", { get: () => 100, enumerable: true, configurable: true })],
  ["hidden", (value, prefix) => void Object.defineProperty(value, prefix + "Name", { enumerable: false })],
  ["frozen", value => void Object.freeze(value)],
  ["another prototype", (value, prefix) => void (delete value[prefix + "Name"], Object.setPrototypeOf(value, { [prefix + "Name"]: "inherited" }))],
];

const positions: [string, (text: string, change: Change) => string | Promise<string>][] = [
  ["variable", intoVariable],
  ["asserted", asserted],
  ["argument", intoArgument],
  ["returned", fromReturn],
  ["field", intoField],
  ["body", (text, change) => awaitedBody(new Response(text), change)],
];

for (const [prefix, read] of positions) {
  const texts = textsFor(prefix);
  for (const text of texts) {
    let said: string;
    try {
      said = await read(text, nothing);
    } catch (error) {
      said = "threw " + (error instanceof SyntaxError ? error.name + ": " + error.message : (error as Error).name);
    }
    console.log(prefix + " " + JSON.stringify(text) + " -> " + said);
  }
  for (const [name, change] of changes) console.log(prefix + ", " + name + " -> " + (await read(texts[0]!, change)));
}

let sum = 0;
let names = 0;
for (let at = 0; at < 300; at++) {
  const value = returned(at % 7 === 3 ? "[" + at + "]" : at % 7 === 5 ? '{"returnedName":"n' + at + '","returnedId":"' + at + '"}' : '{"returnedId":' + at + ',"returnedName":"n' + at + '"}');
  sum += typeof value.returnedId === "number" ? value.returnedId : 1000;
  names += typeof value.returnedName === "string" ? value.returnedName.length : 0;
}
console.log(sum, names);
