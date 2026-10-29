// Exception through tail call under adapter.
type Callee = (...values: unknown[]) => unknown;
type Form = (callee: Callee, list: unknown) => unknown;
type Caller = (form: Form, callee: Callee, list: unknown) => unknown;

const only: number = (globalThis as { rowToRun?: number }).rowToRun ?? -1;

function throwCompiled(value: unknown): unknown {
  throw new TypeError("compiled " + String(value));
}
function throwOneDeeper(value: unknown): unknown {
  const result = throwCompiled(value);
  return [result];
}
function throwTwoDeeper(value: unknown): unknown {
  const result = throwOneDeeper(value);
  return [result];
}
function applyAgain(value: unknown): unknown {
  return throwCompiled.apply(undefined, { length: 1, 0: "again " + String(value) } as any);
}
const throwInterpreted = new Function("value", "throw new TypeError('interpreted ' + String(value));") as Callee;
function applyInterpretedAgain(value: unknown): unknown {
  return throwInterpreted.apply(undefined, { length: 1, 0: "again " + String(value) } as any);
}
function returnValue(value: unknown): unknown {
  return "returned " + String(value);
}

const callees: Array<[string, Callee]> = [
  ["interpreted", throwInterpreted],
  ["compiled", throwCompiled],
  ["compiled two deeper", throwTwoDeeper],
  ["compiled applying again", applyAgain],
  ["compiled applying interpreted again", applyInterpretedAgain],
  ["native", JSON.parse as Callee],
  ["class", class {} as unknown as Callee],
  ["interpreted class", new Function("return class {};")() as Callee],
  ["returning", returnValue],
];

const holder = { method: returnValue as Callee };

const forms: Array<[string, Form]> = [
  ["apply", (callee, list) => callee.apply(undefined, list as any)],
  ["apply with this", function (this: unknown, callee, list) { return callee.apply(this, list as any); }],
  ["Reflect.apply", (callee, list) => Reflect.apply(callee, undefined, list as any)],
  ["spread", (callee, list) => callee(...Array.prototype.values.call(list))],
  ["spread of a set", (callee, list) => callee(...new Set([(list as any)[0]]))],
  ["call", (callee, list) => callee.call(undefined, (list as any)[0])],
  ["plain call", (callee, list) => callee((list as any)[0])],
  ["nine arguments", (callee, list) => callee((list as any)[0], 2, 3, 4, 5, 6, 7, 8, 9)],
  ["bound", (callee, list) => Function.prototype.bind.call(callee, undefined)((list as any)[0])],
  ["bound apply", (callee, list) => Function.prototype.bind.call(callee, undefined).apply(undefined, list as any)],
  ["proxy", (callee, list) => new Proxy(returnValue, { apply: (_target, _receiver, values) => callee(values[0]) })((list as any)[0])],
  ["proxy apply", (callee, list) => new Proxy(returnValue, { apply: (_target, _receiver, values) => callee(values[0]) }).apply(undefined, list as any)],
  ["method by name", (callee, list) => { holder.method = callee; return holder.method((list as any)[0]); }],
  ["untyped apply", (callee: any, list) => callee.apply(undefined, list)],
  ["untyped call of a number", (_callee, list: any) => list.length()],
  ["construct", (callee, list) => Reflect.construct(function () { return callee((list as any)[0]) as any; }, [])],
];

const lists: Array<[string, () => unknown]> = [
  ["array-like", () => ({ length: 1, 0: "{" })],
  ["array", () => ["{"]],
  ["typed array", () => new Uint8Array([7])],
  ["throwing length", () => ({ get length(): number { throw new RangeError("length"); }, 0: "{" })],
  ["throwing element", () => ({ length: 1, get 0(): string { throw new RangeError("element"); } })],
  ["interpreted throwing length", () => Object.defineProperty({ 0: "{" }, "length", { get: new Function("throw new RangeError('interpreted length');") as () => number })],
  ["proxy", () => new Proxy({ length: 1, 0: "{" }, { get: (target, key) => { if (key === "0") throw new RangeError("trap"); return Reflect.get(target, key); } })],
];

const callInterpreted = new Function("form", "callee", "list", "return form(callee, list);") as Caller;
const callInterpretedNotInTailPosition = new Function("form", "callee", "list", "const result = form(callee, list); return result;") as Caller;
const catchInterpreted = new Function(
  "form",
  "callee",
  "list",
  "let a = 1, b = 2, c = 'c'; try { return form(callee, list); } catch (error) { return 'interpreted caller caught ' + error.name + ' ' + (a + b) + c; }",
) as Caller;
const callIndirectEval = (0, eval)("(function (form, callee, list) { return form(callee, list); })") as Caller;

const callers: Array<[string, Caller]> = [
  ["interpreted", callInterpreted],
  ["interpreted, not in tail position", callInterpretedNotInTailPosition],
  ["interpreted with catch", catchInterpreted],
  ["indirect eval", callIndirectEval],
  ["interpreted through bind", (form, callee, list) => callInterpreted(form.bind(undefined), callee, list)],
  ["compiled", (form, callee, list) => [form(callee, list)]],
  ["sort", (form, callee, list) => [1, 2].sort(() => form(callee, list) as any)],
  ["reviver", (form, callee, list) => JSON.parse("1", () => form(callee, list))],
  ["replace", (form, callee, list) => "a".replace("a", () => form(callee, list) as any)],
  ["getter", (form, callee, list) => Reflect.get({ get value(): unknown { return form(callee, list); } }, "value")],
  ["toString", (form, callee, list) => String({ toString: () => form(callee, list) })],
];

function describe(result: unknown): string {
  return typeof result === "string" ? result : typeof result;
}

function describeError(error: unknown): string {
  const { name, message } = error as Error;
  return /^(compiled .*|interpreted .*|length|element|trap)$/.test(message) ? name + " " + message : name;
}

const outcomes = new Map<string, number>();
function report(title: string, outcome: string): void {
  if (only >= 0) console.log(title + outcome);
  outcomes.set(outcome, (outcomes.get(outcome) ?? 0) + 1);
}

let row = 0;
for (const [callerName, caller] of callers) {
  for (const [formName, form] of forms) {
    for (const [calleeName, callee] of callees) {
      for (const [listName, list] of lists) {
        if (only >= 0 && row++ !== only) continue;
        const title = callerName + " | " + formName + " | " + calleeName + " | " + listName + ": ";
        try {
          report(title, describe(caller(form, callee, list())));
        } catch (error) {
          report(title, "caught " + describeError(error));
        }
      }
    }
  }
}

for (const [formName, form] of forms) {
  for (const [calleeName, callee] of callees) {
    for (const [listName, list] of lists) {
      if (only >= 0 && row++ !== only) continue;
      const title = "promise reaction | " + formName + " | " + calleeName + " | " + listName + ": ";
      try {
        report(title, describe(await Promise.resolve(list()).then(value => form(callee, value))));
      } catch (error) {
        report(title, "caught " + describeError(error));
      }
    }
  }
}

if (only < 0) for (const [outcome, count] of outcomes) console.log(count + " " + outcome);
