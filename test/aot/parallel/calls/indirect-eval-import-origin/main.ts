// import() in text that new Function or an indirect eval compiles resolves against the module whose code called them: the same text gives another module from another folder, also with native code between and wherever the working directory is.
import { tmpdir } from "node:os";
import * as nested from "./nested/caller.ts";
import { token as nestedToken } from "./nested/target.ts";
import { token as mainToken } from "./target.ts";

const counts = ((globalThis as any).originEvaluations ??= {}); counts["main"] = (counts["main"] ?? 0) + 1;
const body = 'return import("./target.ts");';
const expression = 'import("./target.ts")';

function callNewFunction(): Promise<any> { const promise = new Function(body)(); return promise; }
function callFunction(): Promise<any> { const promise = Function(body)(); return promise; }
function callIndirectEval(): Promise<any> { const promise = (0, eval)(expression); return promise; }
function callEvalAlias(): Promise<any> { const alias = eval; const promise = alias(expression); return promise; }
function callReflectConstruct(): Promise<any> { const promise = Reflect.construct(Function, [body])(); return promise; }
function callReflectApply(): Promise<any> { const promise = Reflect.apply(Function, undefined, [body])(); return promise; }
function passEvalAsCallback(): Promise<any> { const promise = [expression].map(eval)[0]; return promise; }
function callCreatedLater(): Promise<any> { const created = new Function(body); const promise = Promise.resolve().then(() => created()); return promise; }
function passCreatedToNative(): Promise<any> { const promise = Promise.resolve().then(new Function(body) as any); return promise; }
function callTextInsideText(): Promise<any> { const promise = new Function("return new Function(" + JSON.stringify(body) + ")();")(); return promise; }
function callAsyncFunctionConstructor(): Promise<any> { const promise = new (Object.getPrototypeOf(async function () {}).constructor)("return (await " + expression + ");")(); return promise; }
class Factory {
  create(): Promise<any> {
    const inner = () => { const promise = new Function(body)(); return promise; };
    const promise = inner();
    return promise;
  }
}
function callFromNestedFunction(): Promise<any> { const promise = new Factory().create(); return promise; }
const makers: [string, () => Promise<any>][] = [
  ["new Function", callNewFunction],
  ["Function", callFunction],
  ["indirect eval", callIndirectEval],
  ["alias of eval", callEvalAlias],
  ["Reflect.construct", callReflectConstruct],
  ["Reflect.apply", callReflectApply],
  ["eval as a callback", passEvalAsCallback],
  ["created now, called later", callCreatedLater],
  ["created now, called by native code", passCreatedToNative],
  ["text inside text", callTextInsideText],
  ["async function constructor", callAsyncFunctionConstructor],
  ["from a nested compiled call", callFromNestedFunction],
];

function targetName(namespace: any): string {
  if (namespace.token === mainToken) return mainToken.name;
  if (namespace.token === nestedToken) return nestedToken.name;
  return "another copy";
}

type Case = { label: string; promise: Promise<any>; view: (namespace: any) => string };

function main(): void {
  // Without an origin Bun resolves against the working directory. The runner starts in this folder, where a lost origin would still find target.ts.
  process.chdir(tmpdir());
  const cases: Case[] = [];
  const add = (label: string, promise: Promise<any>, view: (namespace: any) => string = targetName): void => {
    cases.push({ label, promise, view });
  };
  for (const [label, make] of makers) add("main / " + label, make());
  for (const [label, make] of nested.makers) add("nested / " + label, make());
  add("created in nested, called in main", nested.create()());
  add("eval passed to nested", nested.callWith(eval));
  add("arrow function of main passed to nested", nested.callWith(text => { const result = (0, eval)(text); return result; }));
  add("missing file", new Function('return import("./no-such-file.ts");')(), () => "found");
  add("built-in module", new Function('return import("node:os");')(), namespace => typeof namespace.tmpdir);
  add("compiled import in main", import("./target.ts"));
  add("compiled import in nested", nested.importTarget());
  Promise.allSettled(cases.map(({ promise }) => promise)).then(results => {
    const lines = results.map((result, index) => cases[index].label + ": " + (result.status === "fulfilled" ? cases[index].view(result.value) : "rejected"));
    lines.push("evaluations: " + ["main", "target", "nested/caller", "nested/target"].map(file => file + " " + counts[file]).join(", "));
    console.log(lines.join("\n"));
  });
}
setTimeout(main, 0);
/* Output:
main / new Function: rejected
main / Function: rejected
main / indirect eval: rejected
main / alias of eval: rejected
main / Reflect.construct: rejected
main / Reflect.apply: rejected
main / eval as a callback: rejected
main / created now, called later: rejected
main / created now, called by native code: rejected
main / text inside text: rejected
main / async function constructor: rejected
main / from a nested compiled call: rejected
nested / new Function: rejected
nested / Function: rejected
nested / indirect eval: rejected
nested / alias of eval: rejected
nested / Reflect.construct: rejected
nested / Reflect.apply: rejected
nested / eval as a callback: rejected
nested / created now, called later: rejected
nested / created now, called by native code: rejected
nested / text inside text: rejected
nested / async function constructor: rejected
nested / from a nested compiled call: rejected
created in nested, called in main: rejected
eval passed to nested: rejected
arrow function of main passed to nested: rejected
missing file: rejected
built-in module: function
compiled import in main: target beside main
compiled import in nested: nested/target
evaluations: main 1, target 1, nested/caller 1, nested/target 1
*/
