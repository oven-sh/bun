// A field typed by an interface is given what a plain function constructs.
interface Internals { kind: string; limit: number }
interface Schema { internals: Internals; label: string; check(value: unknown): boolean }
interface Issue { code: string; input: unknown; inst?: Schema; schema?: Schema; continue?: boolean }
interface Payload<T = unknown> { value: T; issues: Issue[] }

function construct(this: any, kind: string, limit: number) {
  const inst = this ?? {};
  Object.defineProperty(inst, "internals", { value: { kind, limit }, enumerable: false });
  inst.label = kind + ":" + limit;
  inst.check = function (value: unknown) { return typeof value === kind; };
  return inst;
}
const Constructed = construct as unknown as new (kind: string, limit: number) => Schema;
const record = (kind: string, limit: number): Schema => ({ internals: { kind, limit }, label: kind + "=" + limit, check: value => typeof value === kind });

const pattern = /^SKU-\d+$/;
function checkText(inst: Schema): (payload: Payload<string>) => void {
  return payload => {
    if (pattern.test(payload.value) && payload.value.length <= inst.internals.limit) return;
    payload.issues.push({ code: "text", input: payload.value, inst, continue: !inst.label });
  };
}
function checkNumber(inst: Schema): (payload: Payload<number>) => void {
  return payload => {
    if (payload.value <= inst.internals.limit) return;
    payload.issues.push({ code: "number", input: payload.value, schema: inst });
  };
}
function describe(issue: Issue): string {
  const of = (s: Schema | undefined) => (s === undefined ? "none" : s.label + "/" + s.internals.kind + "/" + s.check(issue.input) + "/" + Object.keys(s).join("+"));
  return [issue.code, String(issue.input), of(issue.inst), of(issue.schema), String(issue.continue), Object.keys(issue).join("+"), "inst" in issue, JSON.stringify(issue)].join(" ");
}

const schemas: Schema[] = [new Constructed("string", 8), record("string", 8), new Constructed("number", 50), record("number", 50)];
const texts = [checkText(schemas[0]), checkText(schemas[1])];
const numbers = [checkNumber(schemas[2]), checkNumber(schemas[3])];
const inputs: unknown[] = ["SKU-1", "SKU-123456789", "other", 7, 70, 50.5];
const seen = new Map<string, number>();
for (let turn = 0; turn < 300; turn++) {
  for (const input of inputs) {
    const payload: Payload = { value: input, issues: [] };
    for (const check of typeof input === "string" ? texts : numbers) (check as (payload: Payload) => void)(payload);
    for (const issue of payload.issues) {
      if (turn % 100 === 99) issue.inst = issue.schema ?? issue.inst;
      if (turn % 150 === 149) delete issue.schema;
      const line = describe(issue);
      seen.set(line, (seen.get(line) ?? 0) + 1);
    }
  }
}
for (const [line, count] of seen) console.log(count, line);
