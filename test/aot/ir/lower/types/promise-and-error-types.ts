// RUN: link
// CHECK: variable {{*}}name="a" module=[[entry]] declared={type=undefined|null|absent|Promise<undefined|null|string> flags=[IsExpected, OmitsNull]}
// CHECK: variable {{*}}name="b" module=[[entry]] declared={type=undefined|null|absent|Error flags=[IsExpected, OmitsNull]}

// `Promise` and `Error` are interfaces that any object with their members satisfies. The class is expected and not checked.
export let a: Promise<string>;
export let b: Error;
