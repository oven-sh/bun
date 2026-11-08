// Object literals of an untyped file none of which has every name keep their own names. One test for each kind of type that follows them.
import { test } from "bun:test";

test("a layout with all the names that nothing names", () => {
  function place(base, where) {
    return (where.kind === "fixed" ? where.value : base) + "!";
  }
  function find(turn) {
    if (turn % 3 === 0) return { kind: "fixed", value: "v" + turn };
    if (turn % 3 === 1) return { kind: "free", other: turn };
    return { kind: "none" };
  }
  let text = "";
  for (let turn = 0; turn < 300; turn++) {
    const where = find(turn);
    text = place("b", where) + text.slice(0, 8);
  }
  console.log(text);
});

test("the fields of a literal elsewhere that has every name", () => {
  const whole = { first: 1, second: 2 };
  function read(value) {
    return String(value.first) + String(value.second);
  }
  function make(flag) {
    return flag ? { first: 3 } : { second: 4 };
  }
  let text = "";
  for (let turn = 0; turn < 300; turn++) text = read(make(turn % 2 === 0)) + read(whole);
  console.log(text);
});

test("a parameter that is handed the one or the other", () => {
  function place(base, where) {
    return (where.kind === "fixed" ? where.value : base) + "!";
  }
  function choose(turn) {
    const where = turn % 2 ? { kind: "fixed", value: "v" + turn } : { kind: "free", other: turn };
    return place("b", where);
  }
  let text = "";
  for (let turn = 0; turn < 300; turn++) text = choose(turn) + choose(turn + 1);
  console.log(text);
});

let current = Date.now() > 0 ? { open: 1 } : { shut: 2 };
test("a variable that holds the one or the other", () => {
  function read() {
    return String(current.open) + String(current.shut);
  }
  function swap() {
    current = current.open ? { shut: 3 } : { open: 4 };
  }
  let text = "";
  for (let turn = 0; turn < 301; turn++) {
    swap();
    text = read();
  }
  console.log(text);
});

test("a list stored under a name of one element", () => {
  function define(tools) {
    const ring = { parts: [{ tag: "t", begin: tools.word }, { begin: /a/, end: /b/, inner: [] }] };
    ring.parts[1].inner = [ring];
    ring.parts[1].more = [ring];
    return ring;
  }
  let n = 0;
  for (let turn = 0; turn < 300; turn++) {
    const ring = define({ word: "w" + turn });
    n += ring.parts[1].inner.length + ring.parts[1].more.length + (ring.parts[1].inner[0] === ring ? 1 : 0) + (ring.parts[0].inner === undefined ? 1 : 0);
  }
  console.log(n);
});
