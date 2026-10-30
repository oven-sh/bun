// The message of a TypeError quotes the read or the call that failed. These functions are only ever called, so a compiled run has their text nowhere but in this file.
import { describe, it } from "bun:test";

const none = null as any;

function expand(value: string) {
  return value.replace(/x/g, "y");
}
function deep(value: { list: number[] }) {
  return value.list.length;
}
function two(first: { a: number }, second: { a: number }) {
  return first.a + second.a;
}
function marked(holder: { inner?: { name: string } }) {
  return holder.inner!.name;
}
// Not `return api.fetchUser(..)`: where a tail call fails, the report of a plain run leaves out the frame of the function that made it.
function call(api: any) {
  api.fetchUser("ARGUMENT", { token: 1 });
}
function markedCall(api: { run?: (text: string) => void }) {
  api.run!("ARGUMENT");
}
function twoCalls(api: any, other: any) {
  return [api.go("a"), other.go("b")];
}
function construct(space: any) {
  return new space.Missing("ARGUMENT");
}

describe("quoted as it is written", () => {
  it("a method of null", () => {
    expand(none);
  });
  it("a member two names deep", () => {
    deep({} as any);
  });
  it("the first of two reads on a line", () => {
    two(none, { a: 1 });
  });
  it("the second of two reads on a line", () => {
    two({ a: 1 }, none);
  });
  it("behind a mark that says it is there", () => {
    marked({});
  });
  it("a call with its arguments", () => {
    call({});
  });
  it("a call behind such a mark", () => {
    markedCall({});
  });
  it("the second of two calls on a line", () => {
    twoCalls({ go() {} }, {});
  });
  it("a construction with its arguments", () => {
    construct({});
  });
});
