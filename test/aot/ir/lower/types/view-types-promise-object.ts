// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|Map<undefined|null|string, number> flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|Set<undefined|null|string> flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="c" module=[[entry]] declared={type=undefined|null|absent|Array<number> flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="d" module=[[entry]] declared={type=undefined|null|absent|Promise<undefined|null|string> flags=[IsExpected, OmitsNull]}

// An interface of the default library that a built-in class implements takes any object with its members. The class is what is expected there, and it is not checked: the position has the flag and no site.
export let a: ReadonlyMap<string, number>;
export let b: ReadonlySet<string>;
export let c: Iterable<number>;
export let d: PromiseLike<string>;
