// In strict code a call in tail position replaces its caller, so a stack trace taken in the callee does not list the caller. That holds wherever the compiler makes an ordinary call of it: in an inlined copy, in front of a check of the result, with a list of arguments, for a built-in, under an await. A call that is not in tail position, and every call in sloppy code, keeps its caller.
// @ts-ignore
import { t_sloppy_outer } from "./sloppy.cjs";
declare const console: any;

function shown(stack: unknown): string {
  const names: string[] = [];
  for (const line of String(stack).split("\n")) {
    const match = /\b(t_[A-Za-z0-9_]+)/.exec(line);
    if (match) names.push(match[1]!);
  }
  return names.join(" < ");
}
function row(name: string, actual: string, expected: string) {
  console.log(name + ": " + actual + (actual === expected ? "" : " BUT THE RULE GIVES " + expected));
}
const hide = <T,>(value: T): any => (JSON.parse("[0]") as number[]).map(() => value)[0];

function t_leaf(): string { const trace = shown(new Error("leaf").stack); return trace; }
function t_leaf_of(first: unknown, second: unknown): string { const trace = shown(new Error(String(first) + second).stack); return trace; }
function t_thrower(): string { throw new Error("thrown"); }

function t_tail(): string { return t_leaf(); }
function t_outer(): string { const trace = t_tail(); return trace + ""; }
row("tail call", t_outer(), "t_leaf < t_outer");

function t_kept(): string { let trace: string; trace = t_leaf(); return trace; }
function t_outer_of_kept(): string { const trace = t_kept(); return trace + ""; }
row("result assigned to a variable", t_outer_of_kept(), "t_leaf < t_kept < t_outer_of_kept");

function t_used(): string { return t_leaf() + ""; }
function t_outer_of_used(): string { const trace = t_used(); return trace + ""; }
row("result used", t_outer_of_used(), "t_leaf < t_used < t_outer_of_used");

function t_tail_of_tail(): string { return t_tail(); }
function t_outer_of_two(): string { const trace = t_tail_of_tail(); return trace + ""; }
row("two tail calls", t_outer_of_two(), "t_leaf < t_outer_of_two");

function t_tail_of_kept(): string { return t_kept(); }
function t_outer_of_mixed(): string { const trace = t_tail_of_kept(); return trace + ""; }
row("tail call of a function that keeps its frame", t_outer_of_mixed(), "t_leaf < t_kept < t_outer_of_mixed");

function t_either(first: boolean): string { return first ? t_leaf() : t_leaf_of(1, 2); }
function t_outer_of_either(first: boolean): string { const trace = t_either(first); return trace + ""; }
row("first arm", t_outer_of_either(true), "t_leaf < t_outer_of_either");
row("second arm", t_outer_of_either(false), "t_leaf_of < t_outer_of_either");

function t_by_value(callee: any): any { return callee(); }
function t_outer_by_value(callee: any): string { const trace = t_by_value(callee); return trace + ""; }
row("unknown callee", t_outer_by_value(hide(t_leaf)), "t_leaf < t_outer_by_value");

function t_by_value_kept(callee: any): any { let trace: any; trace = callee(); return trace; }
function t_outer_by_value_kept(callee: any): string { const trace = t_by_value_kept(callee); return trace + ""; }
row("unknown callee, result assigned to a variable", t_outer_by_value_kept(hide(t_leaf)), "t_leaf < t_by_value_kept < t_outer_by_value_kept");

function t_checked(callee: any): string { return callee(); }
function t_outer_checked(callee: any): string { const trace = t_checked(callee); return trace + ""; }
row("result with a written type", t_outer_checked(hide(t_leaf)), "t_leaf < t_outer_checked");

const receiver = hide({ t_method() { const trace = shown(new Error("method").stack); return trace; } });
function t_calls_method(object: any): any { return object.t_method(); }
function t_outer_of_method(object: any): string { const trace = t_calls_method(object); return trace + ""; }
row("method of an unknown object", t_outer_of_method(receiver), "t_method < t_outer_of_method");

class Box {
  t_get(): string { const trace = shown(new Error("get").stack); return trace; }
  t_forward(): string { return this.t_get(); }
  t_hold(): string { let trace: string; trace = this.t_get(); return trace; }
}
function t_outer_of_class(box: Box): string { const trace = box.t_forward(); return trace + ""; }
row("method of a class", t_outer_of_class(new Box()), "t_get < t_outer_of_class");
function t_outer_of_holding_class(box: Box): string { const trace = box.t_hold(); return trace + ""; }
row("method of a class, result assigned to a variable", t_outer_of_holding_class(new Box()), "t_get < t_hold < t_outer_of_holding_class");

function t_spread(callee: any, list: unknown[]): any { return callee(...list); }
function t_outer_of_spread(callee: any): string { const trace = t_spread(callee, [1, 2]); return trace + ""; }
row("spread arguments", t_outer_of_spread(hide(t_leaf_of)), "t_leaf_of < t_outer_of_spread");

function t_rest(callee: any, ...rest: unknown[]): any { return callee(...rest); }
function t_outer_of_rest(callee: any): string { const trace = t_rest(callee, 1, 2); return trace + ""; }
row("rest parameter passed on", t_outer_of_rest(hide(t_leaf_of)), "t_leaf_of < t_outer_of_rest");

function t_in_loop(callee: any): string {
  let last = "";
  for (let i = 0; i < 3; i++) last = t_by_value(callee);
  return last;
}
row("caller in a loop", t_in_loop(hide(t_leaf)), "t_leaf < t_in_loop");

function t_tail_of_thrower(): string { return t_thrower(); }
function t_catcher(): string { try { return t_tail_of_thrower(); } catch (error: any) { return shown(error.stack); } }
row("error thrown in the callee", t_catcher(), "t_thrower < t_catcher");

function t_keeps_thrower(): string { let result: string; result = t_thrower(); return result; }
function t_catcher_of_kept(): string { try { return t_keeps_thrower(); } catch (error: any) { return shown(error.stack); } }
row("error thrown in the callee, result assigned to a variable", t_catcher_of_kept(), "t_thrower < t_keeps_thrower < t_catcher_of_kept");

function t_catcher_of_host(callee: any): string { try { return t_by_value_with(callee, 1.5); } catch (error: any) { return shown(error.stack); } }
function t_by_value_with(callee: any, argument: unknown): any { return callee(argument); }
row("error thrown in a host function", t_catcher_of_host(hide(BigInt)), "t_catcher_of_host");

function t_catcher_of_nothing(callee: any): string { try { return t_by_value(callee); } catch (error: any) { return shown(error.stack); } }
row("callee that cannot be called", t_catcher_of_nothing(hide(undefined)), "t_by_value < t_catcher_of_nothing");

function t_parses(text: string): any { return JSON.parse(text); }
function t_catcher_of_parse(): string { try { return t_parses("{"); } catch (error: any) { return shown(error.stack); } }
row("error thrown in a built-in", t_catcher_of_parse(), "t_catcher_of_parse");

function t_keeps_parse(text: string): any { let value: any; value = JSON.parse(text); return value; }
function t_catcher_of_kept_parse(): string { try { return t_keeps_parse("{"); } catch (error: any) { return shown(error.stack); } }
row("error thrown in a built-in, result assigned to a variable", t_catcher_of_kept_parse(), "t_keeps_parse < t_catcher_of_kept_parse");

function t_calls_call(callee: () => string): string { return callee.call(undefined); }
function t_outer_of_call(): string { const trace = t_calls_call(t_leaf); return trace + ""; }
row("Function.prototype.call", t_outer_of_call(), "t_leaf < t_outer_of_call");

function t_keeps_call(callee: () => string): string { let trace: string; trace = callee.call(undefined); return trace; }
function t_outer_of_kept_call(): string { const trace = t_keeps_call(t_leaf); return trace + ""; }
row("Function.prototype.call, result assigned to a variable", t_outer_of_kept_call(), "t_leaf < t_keeps_call < t_outer_of_kept_call");

function t_applies(callee: (first: unknown, second: unknown) => string, list: [unknown, unknown]): string { return callee.apply(undefined, list); }
function t_outer_of_apply(): string { const trace = t_applies(t_leaf_of, [1, 2]); return trace + ""; }
row("Function.prototype.apply", t_outer_of_apply(), "t_leaf_of < t_outer_of_apply");

function t_reflects(callee: (first: unknown, second: unknown) => string, list: [unknown, unknown]): string { return Reflect.apply(callee, undefined, list); }
function t_outer_of_reflect(): string { const trace = t_reflects(t_leaf_of, [1, 2]); return trace + ""; }
row("Reflect.apply", t_outer_of_reflect(), "t_leaf_of < t_outer_of_reflect");

function t_mapped(): string { const trace = shown(new Error("mapped").stack); return trace; }
function t_maps(list: number[]): string[] { return list.map(t_mapped); }
function t_outer_of_map(): string { const traces = t_maps([1]); return traces[0] + ""; }
row("callback of a built-in", t_outer_of_map(), "t_mapped < t_outer_of_map");

function t_keeps_map(list: number[]): string[] { let traces: string[]; traces = list.map(t_mapped); return traces; }
function t_outer_of_kept_map(): string { const traces = t_keeps_map([1]); return traces[0] + ""; }
row("callback of a built-in, result assigned to a variable", t_outer_of_kept_map(), "t_mapped < t_keeps_map < t_outer_of_kept_map");

async function t_async_leaf(): Promise<string> { const trace = shown(new Error("async").stack); return trace; }
function t_tail_to_async(): Promise<string> { return t_async_leaf(); }
async function t_awaits(): Promise<string> { const trace = await t_tail_to_async(); return trace + ""; }
row("awaited tail call", await t_awaits(), "t_async_leaf < t_awaits");

function t_keeps_async(): Promise<string> { let promise: Promise<string>; promise = t_async_leaf(); return promise; }
async function t_awaits_kept(): Promise<string> { const trace = await t_keeps_async(); return trace + ""; }
row("awaited call, result assigned to a variable", await t_awaits_kept(), "t_async_leaf < t_keeps_async < t_awaits_kept");

row("sloppy code", t_sloppy_outer(t_leaf), "t_leaf < t_sloppy_tail < t_sloppy_outer");
