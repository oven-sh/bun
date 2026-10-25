// The member that tells the arms of a union apart may stand anywhere in the text. One dispatch finds the arm; an arm without a constant tag takes what no tagged arm takes.
// IR+ ^ .*JSONFindMember
import { JSON } from "bun"; declare const aotOperationCount: undefined | ((name: string) => number);
interface Common { type: string; id: number }
interface Opened extends Common { type: "opened"; by: string }
interface Closed extends Common { type: "closed"; by: string; reason?: string }
interface Moved extends Common { type: "moved"; from: number; to: number }
interface Noted extends Common { type: "noted"; parts: Part[] }
interface Open2 extends Common { type: "open"; wide: boolean }
type Part = { kind: "text"; text: string } | { kind: "link"; href: string; text?: string } | { kind: "rule" };
type Entry = Opened | Closed | Moved | Noted | Open2;
interface Unlisted { type: string }
type EntryOrOther = Entry | Unlisted;
type EntryOrNothing = Entry | null | string | number[];

function describe(run: () => unknown): string {
  try {
    return JSON.stringify(run());
  } catch (error) {
    const issues = (error as { issues?: { path: (string | number)[]; code: string; expected: string; received: string }[] }).issues;
    return issues ? "refused: " + issues.map(issue => issue.path.join(".") + " " + issue.code + " " + issue.expected + " " + issue.received).join("; ") : String((error as Error).name);
  }
}
function orders<T>(items: T[]): T[][] {
  if (items.length < 2) return [items];
  return items.flatMap((item, at) => orders([...items.slice(0, at), ...items.slice(at + 1)]).map(rest => [item, ...rest]));
}
let different = 0;
let total = 0;
for (const members of [['"type":"opened"', '"id":1', '"by":"a"', '"o":{"type":"closed"}'], ['"type":"moved"', '"id":2', '"from":1', '"to":2'], ['"type":"noted"', '"id":3', '"parts":[{"text":"t","kind":"text"},{"kind":"rule","o":1},{"o":[{"kind":"text"}],"href":"h","kind":"link"}]', '"p":"\\"type\\":\\"moved\\""']]) {
  for (const order of orders(members)) {
    const text = "{" + order.join(",") + "}";
    for (const parse of [(t: string) => JSON.parse<Entry>(t), (t: string) => JSON.parse<EntryOrOther>(t), (t: string) => JSON.parse<EntryOrNothing>(t)]) {
      total++;
      if (describe(() => parse(text)) !== text && different++ < 3) console.log("DIFFERS", text, describe(() => parse(text)));
    }
  }
}
console.log("every order of four members:", total, "parses,", different, "differ");

const texts = [
  '{"type":"open","id":1,"wide":true}',
  '{"id":1,"wide":true,"type":"open"}',
  '{"type":"opened","id":1}',
  '{"id":1,"type":"opened"}',
  '{"type":"opening","id":1,"by":"a"}',
  '{"id":1,"by":"a","type":"opening"}',
  '{"id":1,"by":"a"}',
  '{"type":5,"id":1,"by":"a"}',
  '{"type":null}',
  '{"type":"closed","id":1,"by":"a","reason":5}',
  '{"type":"closed","type":"opened","id":1,"by":"a"}',
  '{"type":"moved","id":1,"by":"a","type":"opened"}',
  '{"id":1,"type":"opened","by":"a","type":"opened"}',
  '{"type":"\\u006fpened","id":1,"by":"a"}',
  '{"id":1,"by":"a","type":"open\\u0065d"}',
  '{"\\u0074ype":"opened","id":1,"by":"a"}',
  '{"id":1,"t\\u0079pe":"opened","by":"a"}',
  '{ "id" : 1 , "type" : "opened" , "by" : "a" }',
  '{\n  "type": "opened",\n  "id": 1,\n  "by": "a"\n}',
  '{"Type":"opened","id":1,"by":"a"}',
  '{"o":{"type":"opened","id":1,"by":"a"}}',
  '{"type":"noted","id":1,"parts":[{"kind":"image"}]}',
  '{"type":"noted","id":1,"parts":[{"text":"t"}]}',
  '{"parts":[{"href":"h","kind":"link","text":5}],"id":1,"type":"noted"}',
  "{}",
  "null",
  '"opened"',
  "[1,2]",
  '["opened"]',
  "5",
  '{"type":"opened","id":1,"by":"a"',
  '{"id":1,"by":"a","type":"opened"]',
  '{"id":1,"by":"a",type:"opened"}',
  '{"id":1,"o":[1,,2],"type":"opened","by":"a"}',
];
for (const text of texts) console.log(JSON.stringify(text), "|", describe(() => JSON.parse<Entry>(text)), "|", describe(() => JSON.parse<EntryOrOther>(text)), "|", describe(() => JSON.parse<EntryOrNothing>(text)));

const counted = typeof aotOperationCount === "function" ? aotOperationCount : null;
const readAgain = () => (counted ? counted("operationAOTJSONSourceAbandon") : 0);
const before = readAgain();
let sum = 0;
for (const text of ['{"id":1,"by":"a","type":"opened"}', '{"id":2,"o":1,"type":"moved","from":1,"to":2}', '{"id":3,"type":"other"}', '{"type":"closed","id":4}']) sum += (JSON.parse<EntryOrOther>(text) as Common).id;
console.log("read once:", sum, readAgain() === before);
const taken = JSON.parse<EntryOrOther>('{"type":"noted","id":5,"parts":[{"kind":"rule"},{"kind":"none"}]}') as Common;
console.log("an arm that holds objects refuses: they are not parsed again arm by arm, the engine reads the text:", taken.id, counted ? readAgain() === before + 1 : true);
