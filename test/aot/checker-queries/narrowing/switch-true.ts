// Each `case` test of `switch (true)` narrows in its clause, and `default` gets what no test accepts. The test can be about a property, a nested property, a property of `this` or an element at a constant key. A clause also knows that the tests before it failed. Clauses that share their statements, or fall through, get the union.
declare const x: string | number;
switch (true) {
  case typeof x === "string":
    x;
    break;
  default:
    x;
}

interface Word { kind: "word"; text: string }
interface Digits { kind: "digits"; value: number }
interface Space { kind: "space" }
type Token = Word | Digits | Space;
interface Entry { token: Token; inner: { token: Token } }
function isDigits(token: Token): token is Digits { return token.kind === "digits"; }

function properties(entry: Entry) {
  switch (true) {
    case entry.token.kind === "word":
      entry.token;
      break;
    case isDigits(entry.token):
      entry.token;
      break;
    default:
      entry.token;
  }
}

function nestedProperties(entry: Entry) {
  switch (true) {
    case entry.inner.token.kind === "space":
      entry.inner.token;
      entry.token;
      break;
    default:
      entry.inner.token;
  }
}

class Reader {
  token: Token;
  constructor(token: Token) {
    this.token = token;
  }
  read() {
    switch (true) {
      case this.token.kind === "word":
        this.token;
        break;
      case this.token.kind === "digits":
        this.token;
        break;
      default:
        this.token;
    }
  }
}

function constantKeys(pair: [Token, Token], entry: Entry) {
  switch (true) {
    case pair[0].kind === "word":
      pair[0];
      pair[1];
      break;
    case entry["token"].kind === "digits":
      entry.token;
      pair[0];
      break;
  }
}

function sharedStatements(entry: Entry) {
  switch (true) {
    case entry.token.kind === "word":
    case entry.token.kind === "digits":
      entry.token;
      break;
    default:
      entry.token;
  }
}

function fallThrough(entry: Entry) {
  switch (true) {
    case entry.token.kind === "word":
      entry.token;
    case entry.token.kind === "digits":
      entry.token;
      break;
  }
}

export {};
