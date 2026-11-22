// With "experimentalDecorators" a closure in the decorator of a member or a parameter that names its class reads what the class decorator has returned.
import { test } from "bun:test";
const thunks: Array<() => any> = [];
function link(thunk: () => any) { return (_t: any, _k: any, _i?: number) => { thunks.push(thunk); }; }
function swap(_original: any): any { return class Replacement { static tag = "replacement"; }; }
const kept: any[] = [];
function keep(target: any) { kept.push(target); }
@swap
@keep
class Branch {
  static tag = "original";
  @link(() => Branch) parent: any;
  grow(@link(() => Branch) by: number) { return by; }
  who() { return Branch.tag; }
}
test("closures in the decorators of members", () => {
  console.log(thunks.map((thunk) => thunk().tag).join(" "));
});
test("a name in the body of the class", () => {
  console.log(new kept[0]().who(), (Branch as any).tag);
});
