// COUNT: operation:operationAOTDefineOwnProperty = 0
// COUNT: arrivals = 0
type Rule = { pattern: string; regex?: number; checkRegex?: number; negative: boolean };
interface Marked {
  shown: number;
  hidden?: number;
}
class Node {
  declare mark?: number;
  kind = 1;
}
function define<T extends object>(object: T, key: keyof T & string, value: number) {
  return Object.defineProperty(object, key, { value });
}
let sum = 0;
let lastRule: Rule | undefined;
let lastMarked: Marked | undefined;
let lastNode: Node | undefined;
for (let turn = 0; turn < 2000; turn++) {
  const rule: Rule = { pattern: "a" + (turn & 7), negative: false };
  define(rule, "regex", turn);
  define(rule, "checkRegex", turn + 1);
  const marked: Marked = { shown: 1 };
  Object.defineProperty(marked, "hidden", { value: turn, enumerable: false });
  const node = new Node();
  Object.defineProperty(node, "mark", { value: turn, writable: true });
  sum += rule.regex! + rule.checkRegex! + marked.hidden! + marked.shown + node.mark! + node.kind;
  lastRule = rule;
  lastMarked = marked;
  lastNode = node;
}
console.log(sum);
for (const last of [lastRule!, lastMarked!, lastNode!] as object[])
  console.log(
    JSON.stringify(Object.getOwnPropertyDescriptors(last)),
    Object.keys(last).join(),
    Object.getOwnPropertyNames(last).join(),
    JSON.stringify(last),
    JSON.stringify({ ...last }),
  );
