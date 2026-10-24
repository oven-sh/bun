function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

function buildWithAPieceThatReadsTheText() {
  let text = "";
  const reader = { toString: () => "(" + text.length + ")" };
  for (let i = 0; i < 4; i++) {
    text += "ab";
    text += reader;
  }
  return text;
}

function buildWithAPieceThatStoresToTheText() {
  let text = "start";
  const writer = {
    toString() {
      text = "replaced";
      return "!";
    },
  };
  text += writer;
  const afterTheFirst = text;
  text = text + writer;
  const afterTheSecond = text;
  text = writer + text;
  return [afterTheFirst, afterTheSecond, text];
}

function buildWithAPieceThatAppendsToTheText() {
  let text = "";
  let depth = 0;
  const appender = {
    toString() {
      if (depth++ < 2) text += "inner" + depth;
      return "outer" + depth;
    },
  };
  for (let i = 0; i < 3; i++) text += appender;
  return text;
}

function buildInATemplateWithAPieceThatStores() {
  let text = "start";
  const writer = {
    toString() {
      text = "replaced";
      return "!";
    },
  };
  const first = `${text}${writer}${text}`;
  text = "start";
  const second = `${writer}${text}`;
  return [first, second];
}

function buildAndThrowHalfway(pieces) {
  let text = "";
  try {
    for (const piece of pieces) text += piece;
  } catch (error) {
    return [text, error.constructor.name];
  }
  return [text];
}

function buildInAField(holder, pieces) {
  for (const piece of pieces) holder.text += piece;
  return holder.text;
}

function buildWhileThePiecesChange(pieces) {
  let text = "";
  for (let i = 0; i < pieces.length; i++) text += pieces[i];
  return text;
}

for (let i = 0; i < 2000; i++) {
  buildAndThrowHalfway(["a", "b"]);
  buildInAField({ text: "" }, ["a", "b"]);
  buildWhileThePiecesChange(["a", "b"]);
}

attempt("a piece reads the text", buildWithAPieceThatReadsTheText);
attempt("a piece stores to the text", buildWithAPieceThatStoresToTheText);
attempt("a piece appends to the text", buildWithAPieceThatAppendsToTheText);
attempt("a piece stores to the text of a template", buildInATemplateWithAPieceThatStores);
attempt("a symbol halfway", () => buildAndThrowHalfway(["a", "b", Symbol("s"), "c"]));
attempt("a throwing conversion halfway", () => buildAndThrowHalfway(["a", { toString() { throw new RangeError("no"); } }, "c"]));
attempt("a BigInt after a number", () => buildAndThrowHalfway([1, 2n]));
attempt("a field that is a getter and a setter", () => {
  const log = [];
  let stored = "";
  const holder = {
    get text() {
      log.push("get");
      return stored;
    },
    set text(value) {
      log.push("set " + value);
      stored = value;
    },
  };
  return [buildInAField(holder, ["a", 1, "b"]), log];
});
attempt("a field that starts as a number", () => buildInAField({ text: 1 }, [2, "a", 3]));
attempt("a field that is missing", () => buildInAField({}, ["a", "b"]));
attempt("a field that cannot be stored to", () => buildInAField(Object.freeze({ text: "frozen" }), ["a", "b"]));
attempt("a field that a piece replaces", () => {
  const holder = { text: "start" };
  return buildInAField(holder, ["a", { toString() { holder.text = "replaced"; return "!"; } }, "b"]);
});
attempt("a piece shortens the list", () => {
  const pieces = ["a", null, "c", "d"];
  pieces[1] = { toString() { pieces.length = 2; return "b"; } };
  return buildWhileThePiecesChange(pieces);
});
attempt("a piece lengthens the list", () => {
  const pieces = ["a", null];
  pieces[1] = { toString() { if (pieces.length < 5) pieces.push("more"); return "b"; } };
  return buildWhileThePiecesChange(pieces);
});
attempt("a piece replaces a later piece", () => {
  const pieces = ["a", null, "c"];
  pieces[1] = { toString() { pieces[2] = 3; return "b"; } };
  return buildWhileThePiecesChange(pieces);
});
