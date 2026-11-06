// A reader made of a chain of classes and a mixin walks a list of tokens. The names that its loop reads and writes lie on the global object, where a table has put them,
// and the method with the loop is called by a name out of that table.
var lists = Below =>
  class WithLists extends Below {
    readList({}) {
      const wasInList = this.state.inList;
      if (mayBeExact && this.isAt(6)) {
        this.mustPass(6);
      } else {
        this.mustPass(5);
      }
      while (!this.isAt(closer)) {
        if (mayBeMarked && this.isWord(118)) {
          const ahead = this.peek();
          if (ahead.kind !== 14 && ahead.kind !== 17) {
            this.advance();
            markedAt = this.state.startsAt;
            mayBeFixed = false;
          }
        }
        if (this.pass(0)) {
          if (markedAt != null) {
            this.refuse(markedAt);
          }
          if (this.pass(0)) {
            if (sign) {
              this.refuse(sign.place.start);
            }
            list.slots.push(this.readSlot(item, isFixed));
          } else {
            list.indexers.push(this.readIndexer(item, isFixed, sign));
          }
        } else if (this.isAt(10) || this.isAt(47)) {
        } else {
          if (this.isWord(99) || this.isWord(104)) {
            const ahead = this.peek();
            if (isNameOfEntry(ahead.kind)) {
              how = this.state.value;
              this.advance();
            }
          }
          const found = this.readEntry(
            item,
            isFixed,
            markedAt,
            sign,
            how,
            mayBeSpread,
            mayBeOpen != null ? mayBeOpen : !isExact,
          );
          if (found === null) {
            openAt = this.state.lastStartedAt;
          } else {
            list.entries.push(found);
          }
        }
        this.endEntry();
        if (openAt && !this.isAt(8) && !this.isAt(9)) {
        }
      }
      this.state.inList = wasInList;
    }
    endEntry() {
      this.advance();
    }
    goBack(first, startsAt, third) {
      if (failed || invalid.length > 0) {
        if (failed && valid.length === 1) {
          this.state = state;
        }
      }
    }
  };
class Lowest {}
class WithNotes extends Lowest {}
class Tokens extends WithNotes {
  constructor(tokens) {
    super();
    this.tokens = tokens;
    this.state = { kind: 0, value: 0, startsAt: 0, lastStartedAt: 0, inList: false };
  }
  pass(kind) {
    if (this.isAt(kind)) {
      this.advance();
      return true;
    }
    return false;
  }
  isAt(kind) {
    return this.state.kind === kind;
  }
}
class WithHelpers extends Tokens {
  mustPass(kind) {
    if (!this.pass(kind)) this.refuse(kind);
  }
  isWord(kind) {
    return this.state.kind === kind;
  }
  advance() {
    this.state.startsAt = this.state.value;
    this.state.kind = this.tokens[this.state.value++];
  }
  peek() {
    return { kind: this.tokens[this.state.value] };
  }
  refuse(place) {
    throw new SyntaxError("refuse " + place);
  }
}
class WithNodes extends WithHelpers {}
class WithTargets extends WithNodes {}
const mixins = {
  lists,
};
class WithExpressions extends WithTargets {}
class WithStatements extends WithExpressions {}
class Reader extends WithStatements {
  read() {
    this.advance();
    return { whole: { items: [this[entry]({})] } };
  }
}
function read(given, options) {
  if (((_options = options) == null ? void 0 : _options.form) === "either") {
  } else {
    return readerFor(options, given).read();
  }
}
function readerFor(options, given) {
  let made = Reader;
  if (options != null && options.parts) {
    made = classWith(options.parts);
  }
  return new made(given);
}
function classWith(names) {
  let made = Reader;
  for (const part of names) {
    made = mixins[part](made);
  }
  return made;
}
Object.assign(
  globalThis,
  JSON.parse(
    '{"entry":"readList","mayBeExact":true,"mayBeMarked":true,"mayBeFixed":true,"closer":8,"markedAt":null,"openAt":null,"sign":null}',
  ),
);
console.log(read([5, 118, 10, 10, 8], { parts: ["lists"] }).whole.items.length, markedAt, mayBeFixed);
for (const tokens of [[5, 10, 8], [6, 8], [5, 118, 14, 10, 8], [5, 0, 8], [5, 7, 8], [4]]) {
  markedAt = null;
  try {
    console.log(read(tokens, { parts: ["lists"] }).whole.items.length, markedAt, mayBeFixed);
  } catch (error) {
    console.log(error.name, error.message);
  }
}
