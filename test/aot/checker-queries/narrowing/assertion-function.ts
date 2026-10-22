// A call to an assertion function narrows its argument in the statements after the call. The argument can be a property, a nested property, a property of `this` or an element at a constant key. An `asserts this is T` method narrows its receiver, and `asserts condition` narrows like an `if`. The narrowing of a property lasts until that property path is assigned: a store through an alias or a call doesn't reset it.
function assertString(v: unknown): asserts v is string {}
declare const x: string | number;
x;
assertString(x);
x;

interface Word { kind: "word"; text: string }
interface Digits { kind: "digits"; value: number }
type Token = Word | Digits;
interface Entry { token: Token; inner: { token: Token } }
function assertWord(token: Token): asserts token is Word {}
function assert(condition: unknown): asserts condition {}
declare function change(entry: Entry): void;

function properties(entry: Entry) {
  assertWord(entry.inner.token);
  entry.inner.token;
  entry.token;
  assertWord(entry.token);
  entry.token;
}

class Reader {
  token: Token;
  constructor(token: Token) {
    this.token = token;
  }
  read() {
    assertWord(this.token);
    this.token;
  }
}

function constantKeys(pair: [Token, Token], entry: Entry) {
  assertWord(pair[0]);
  pair[0];
  pair[1];
  assertWord(entry["token"]);
  entry.token;
}

class Shape {
  assertRound(): asserts this is Round {}
}
class Round extends Shape {
  radius = 1;
}
function receivers(shape: Shape, holder: { shape: Shape }) {
  shape.assertRound();
  shape;
  holder.shape.assertRound();
  holder.shape;
}

function conditions(entry: Entry, other: Entry) {
  assert(entry.token.kind === "word");
  entry.token;
  assert(other.token.kind === "word" && other.inner.token.kind === "digits");
  other.token;
  other.inner.token;
}

function aliasStoreAndCall(entry: Entry, alias: Entry, other: Token) {
  assertWord(entry.token);
  alias.token = other;
  entry.token;
  change(entry);
  entry.token;
  entry.token = other;
  entry.token;
}

export {};
