// A call to a function declared `x is T` narrows its argument in both branches when the argument is a property, a nested property, a property of `this` or an element at a constant key. A `this is T` method narrows its receiver. A function whose body is such a check gets an inferred type predicate. The narrowing of a property lasts until that property path is assigned: a store through an alias or a call doesn't reset it.
interface Word { kind: "word"; text: string }
interface Digits { kind: "digits"; value: number }
type Token = Word | Digits;
interface Entry { token: Token; inner: { token: Token } }
function isWord(token: Token): token is Word { return token.kind === "word"; }
function isDigits(token: Token) { return token.kind === "digits"; }
declare function change(entry: Entry): void;

function properties(entry: Entry) {
  if (isWord(entry.inner.token)) {
    entry.inner.token;
    entry.token;
  } else {
    entry.inner.token;
  }
  if (isWord(entry.token)) {
    entry.token;
  } else {
    entry.token;
  }
}

class Reader {
  token: Token;
  constructor(token: Token) {
    this.token = token;
  }
  read() {
    if (isWord(this.token)) {
      this.token;
    } else {
      this.token;
    }
  }
}

function constantKeys(pair: [Token, Token], entry: Entry) {
  if (isWord(pair[0])) {
    pair[0];
    pair[1];
  }
  if (isWord(entry["token"])) {
    entry.token;
  }
}

class Shape {
  isRound(): this is Round {
    return this instanceof Round;
  }
}
class Round extends Shape {
  radius = 1;
}
function receivers(shape: Shape, holder: { shape: Shape }) {
  if (shape.isRound()) {
    shape;
  } else {
    shape;
  }
  if (holder.shape.isRound()) {
    holder.shape;
  } else {
    holder.shape;
  }
}

function inferredPredicate(entry: Entry) {
  if (isDigits(entry.token)) {
    entry.token;
  } else {
    entry.token;
  }
}

function otherControlFlow(entry: Entry) {
  isWord(entry.token) &&
    entry.token;
  isWord(entry.token)
    ? entry.token
    : entry.token;
  if (!isWord(entry.token)) {
    return;
  }
  entry.token;
}

function aliasedCondition(entry: { readonly token: Token }) {
  const isText = isWord(entry.token);
  if (isText) {
    entry.token;
  } else {
    entry.token;
  }
}

function aliasStoreAndCall(entry: Entry, alias: Entry, other: Token) {
  if (isWord(entry.token)) {
    alias.token = other;
    entry.token;
    change(entry);
    entry.token;
    entry.token = other;
    entry.token;
  }
}

export {};
