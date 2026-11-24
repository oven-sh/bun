// A table of signs: the text of a sign is compiled into an expression, and what its groups find of a place becomes the parameters.
"use strict";
module.exports = makeTable;
module.exports.compile = compile;

function compile(text, whole) {
  const names = [];
  let source = "^";
  let at = 0;
  while (at < text.length) {
    const letter = text[at];
    if (letter === ":") {
      let end = at + 1;
      while (end < text.length && /\w/.test(text[end])) end++;
      const name = text.slice(at + 1, end);
      const optional = text[end] === "?";
      names.push(name);
      source += optional ? "([^/]*)" : "([^/]+)";
      at = optional ? end + 1 : end;
    } else if (letter === "*") {
      names.push("rest");
      source += "(.*)";
      at++;
    } else {
      source += /[.+^$()[\]{}|\\]/.test(letter) ? "\\" + letter : letter;
      at++;
    }
  }
  return { names, expression: new RegExp(source + (whole ? "/?$" : "(?=/|$)")) };
}

function Sign(text, whole, word, answer) {
  const compiled = compile(text, whole);
  this.text = text;
  this.word = word;
  this.names = compiled.names;
  this.expression = compiled.expression;
  this.answer = answer;
  this.found = 0;
}

Sign.prototype.look = function (place) {
  const groups = this.expression.exec(place);
  if (!groups) return null;
  const parameters = {};
  for (let at = 0; at < this.names.length; at++) {
    const value = groups[at + 1];
    if (value !== undefined && value !== "") parameters[this.names[at]] = decode(value);
  }
  this.found++;
  return { parameters, length: groups[0].length };
};

function decode(value) {
  return value.indexOf("%") < 0 ? value : decodeURIComponent(value);
}

function makeTable() {
  const signs = [];
  function table(asked) {
    return walk(asked, asked.place, {});
  }
  function walk(asked, place, above) {
    for (const sign of signs) {
      if (sign.word !== "any" && sign.word !== asked.word) continue;
      const seen = sign.look(place);
      if (seen === null) continue;
      const parameters = Object.assign({}, above, seen.parameters);
      const inner = sign.answer.walk;
      const said = inner ? inner(asked, place.slice(seen.length) || "/", parameters) : sign.answer(parameters, asked);
      if (said !== undefined) return said;
    }
    return undefined;
  }
  table.walk = walk;
  table.signs = signs;
  table.get = (text, answer) => (signs.push(new Sign(text, true, "get", answer)), table);
  table.put = (text, answer) => (signs.push(new Sign(text, true, "put", answer)), table);
  table.under = (text, answer) => (signs.push(new Sign(text, false, "any", answer)), table);
  return table;
}
