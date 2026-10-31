// Part of indirect-eval-import-origin.
const counts = ((globalThis as any).originEvaluations ??= {}); counts["nested/caller"] = (counts["nested/caller"] ?? 0) + 1;
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
export const makers: [string, () => Promise<any>][] = [
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

export function create(): any { const created = new Function(body); return created; }
export function callWith(evaluate: (text: string) => any): any { const result = evaluate(expression); return result; }
export function importTarget(): Promise<any> { const promise = import("./target.ts"); return promise; }
