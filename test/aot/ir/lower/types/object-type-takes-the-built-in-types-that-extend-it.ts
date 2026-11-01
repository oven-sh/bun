// RUN: link
// CHECK: layout [[range]] name="TextRange" module=[[entry]]
// CHECK: layout [[end]] module=[[entry]] {{*}}fields=[{key="end"
// CHECK: layout [[named]] name="Named" module=[[entry]]
// CHECK: layout [[other]] module=[[entry]] {{*}}fields=[{key="other"
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|[[range]]|Array|Map site=
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|[[end]]|Array|Map site=
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|[[named]]|Map site=
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|absent|[[other]] site=

// An array with a `pos` and an `end` is a TextRange. No layout lists it, so an object type lists the class of each interface of the program that extends a built-in type and has the members the object type requires.
interface TextRange {
  pos: number;
  end: number;
}

interface Named {
  name: string;
}

interface NodeArray<T> extends ReadonlyArray<T>, TextRange {}

interface Index extends Map<string, number> {
  pos: number;
  end: number;
  name: string;
}

export let a: TextRange;
export let b: { end: number };
export let c: Named;
export let d: { other: number };
