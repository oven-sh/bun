// Values of every kind where closures capture a string that equals an imported constant in a validating build.
// Flags: --aot-validate
import { READ_TOOL } from "./names";
type Decision = { behavior: string; message: string } | null;
type Hooks = {
  replyGrant: null;
  threadId: () => string | undefined;
  lateDeny: () => Decision;
  askRule: (rules: string[]) => string;
  updatedInput: () => undefined;
};
class Notice {
  async decide(context: { depth: number }, target: string, hooks: Hooks): Promise<string> {
    await null;
    return [context.depth, target, hooks.threadId(), JSON.stringify(hooks.lateDeny()), hooks.askRule(["a", "read_comments"]), hooks.updatedInput()].join(" | ");
  }
}
function noticeRead(input: unknown): Notice | undefined {
  return typeof input === "object" && input !== null ? new Notice() : undefined;
}
function refusal(name: string, input: unknown): Decision | undefined {
  return name.charCodeAt(0) === 114 && input !== null ? { behavior: "deny", message: name.slice(5) + name.length } : undefined;
}
function ruleForCall(rules: string[], name: string): { rule: string } | undefined {
  const found = rules.find(rule => rule === name);
  return found === undefined ? undefined : { rule: found + ":" + name.toUpperCase() };
}
async function check(name: string, input: unknown): Promise<string> {
  if (name === READ_TOOL) {
    const under = await noticeRead(input)?.decide({ depth: 1 }, "target", {
      replyGrant: null,
      threadId: () => undefined,
      lateDeny: () => refusal(name, input) ?? null,
      askRule: rules => ruleForCall(rules, name)?.rule ?? "none",
      updatedInput: () => undefined,
    });
    return "under " + String(under);
  }
  return "past " + typeof name;
}
class Named {
  [Symbol.toPrimitive]() {
    return "read_comments";
  }
}
const values: any[] = [
  "read_comments",
  "read_" + String(["comments"]),
  ["read", "comments"].join("_"),
  "write_comments",
  "",
  new String("read_comments"),
  { toString: () => "read_comments" },
  { valueOf: () => "read_comments" },
  new Named(),
  ["read_comments"],
  () => "read_comments",
  Symbol.for("read_comments"),
  new Proxy({}, {}),
  Object.create(null),
  /read_comments/,
  new Date(0),
  1,
  -0,
  NaN,
  1n,
  true,
  false,
  null,
  undefined,
];
for (let round = 0; round < 40; round++) {
  const lines: string[] = [];
  for (const value of values) for (const input of [{}, null, 1]) lines.push(await check(value, input));
  if (round === 0 || round === 39) console.log(lines.join("\n"));
}
