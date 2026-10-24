// A member that validate<T>(value) would copy stays as the argument has it, absent or undefined, however the copy is created: field by field, with undeclared properties beside the fields, and as an ordinary object for a type of more than 64 fields.
// COUNTER: CloneAsFieldLimitReached >= 1
import { validate } from "bun:bundle";

type Inner = { x: number };
type Small = { a: number; inner?: Inner };
type Wide = {
  f0: number; f1: number; f2: number; f3: number; f4: number; f5: number; f6: number; f7: number; f8: number; f9: number; f10: number; f11: number; f12: number; f13: number; f14: number; f15: number;
  f16: number; f17: number; f18: number; f19: number; f20: number; f21: number; f22: number; f23: number; f24: number; f25: number; f26: number; f27: number; f28: number; f29: number; f30: number; f31: number;
  f32: number; f33: number; f34: number; f35: number; f36: number; f37: number; f38: number; f39: number; f40: number; f41: number; f42: number; f43: number; f44: number; f45: number; f46: number; f47: number;
  f48: number; f49: number; f50: number; f51: number; f52: number; f53: number; f54: number; f55: number; f56: number; f57: number; f58: number; f59: number; f60: number; f61: number; f62: number; f63: number;
  inner?: Inner;
};

const parse = (text: string): any => JSON.parse(text);
function withUndefined(text: string): any {
  const value = parse(text);
  value.inner = undefined;
  return value;
}
function show(what: string, argument: any, copy: any): void {
  const keys = Object.keys(copy);
  console.log(what, keys.length, keys.slice(-3).join(), "inner" in copy, JSON.stringify(copy.inner), copy !== argument, copy.inner === argument.inner);
}
function small(what: string, argument: any): void {
  show(what, argument, validate<Small>(argument));
}
function wide(what: string, argument: any): void {
  const copy = validate<Wide>(argument);
  show(what, argument, copy);
  console.log(copy.f0 + copy.f63);
}

const fields = Array.from({ length: 64 }, (_, index) => `"f${index}":${index}`).join();
for (let round = 0; round < 2; round++) {
  small("declared members, absent", parse('{"a":1}'));
  small("declared members, undefined", withUndefined('{"a":1}'));
  small("declared members, present", parse('{"inner":{"x":2},"a":1}'));

  small("an undeclared property, absent", parse('{"a":1,"more":true}'));
  small("an undeclared property, undefined", withUndefined('{"more":true,"a":1}'));
  small("an undeclared property, present", parse('{"more":true,"inner":{"x":2},"a":1}'));

  wide("65 fields, absent", parse(`{${fields}}`));
  wide("65 fields, undefined", withUndefined(`{${fields}}`));
  wide("65 fields, present", parse(`{"inner":{"x":2},${fields}}`));
}
