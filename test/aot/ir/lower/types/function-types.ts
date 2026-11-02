// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|[[arrow]] site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|[[overloads]] site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|[[class]] site=
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|function|absent site=
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|absent|[[withThis]] site=
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=undefined|null|function|absent flags=[IsExpected, OmitsNull]}
// CHECK: function {{*}}name="C" module=[[entry]] {{*}}functionTypes=[{{*}}[[class]]]
// CHECK: function [[arrow]] module=[[entry]] role=Signature
// CHECK: function [[overloads]] module=[[entry]] role=Signature
// CHECK: function [[withThis]] module=[[entry]] role=Signature
// CHECK: function [[class]] module=[[entry]] role=Signature

// A written function type is a function of its own: a record with the role `Signature` and no body. It stands for the functions that the program converts to it, so it says nothing about parameters or results itself. Overloads share one record. `typeof C` is the signature of the constructor, and `C` lists it. `Function` is any function. `CallableFunction` is an interface, so a function is only expected.
export class C {}

export let a: (a: string) => number;
export let b: { (a: string): void; (a: number): void };
export let c: typeof C;
export let d: Function;
export let e: (this: Date, a: string, b?: number, ...rest: boolean[]) => void;
export let f: CallableFunction;
