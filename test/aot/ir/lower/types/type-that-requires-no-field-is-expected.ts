// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|{{*}}|L{{*}} flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|{{*}}|L{{*}} flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|{{*}}|L{{*}} flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|{{*}}|L{{*}} flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="e" module=[[entry]] declared={type=undefined|null|{{*}}|L{{*}} flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="f" module=[[entry]] declared={type=undefined|null|{{*}}|L{{*}} flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="g" module=[[entry]] declared={type=undefined|null|object|absent site=
// CHECK: variable {{*}}name="h" module=[[entry]] declared={type=undefined|null|absent|L{{*}} site=

// A layout tells objects apart by the fields they must have. Every object is of a type whose members are all optional, and a member with an index or a symbol for a name is no field. So the layout of such a type is only expected: no object fails a test there. A type that is only an index signature has no layout and is `object`. One required field is enough for a test.
interface Options {
  module?: number;
  target?: number;
}

enum Kind {
  A,
  B,
}

export let a: Options;
export let b: Pick<Options, "target">;
export let c: Partial<{ x: number }>;
export let d: { [key: string]: number | undefined; id?: number };
export let e: Record<Kind, string>;
export let f: { [Symbol.iterator](): Iterator<number> };
export let g: { [key: string]: number };
export let h: { module?: number; name: string };
