// A tokenizer that reads character codes, switches on them and allocates one small object a token, with a `text` or with a `value`.
function isDigit(code) {
  return code >= 48 && code <= 57;
}
function isLetter(code) {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95;
}

var keywords = { if: true, else: true, while: true, return: true, var: true, function: true };

function tokenize(source) {
  var tokens = [];
  var at = 0;
  var length = source.length;
  while (at < length) {
    var code = source.charCodeAt(at);
    var start = at;
    switch (code) {
      case 32:
      case 10:
      case 9:
        at++;
        continue;
      case 40:
      case 41:
      case 123:
      case 125:
      case 59:
      case 44:
        at++;
        tokens.push({ kind: "punctuation", text: source.charAt(start), at: start });
        continue;
      case 34:
        at++;
        while (at < length && source.charCodeAt(at) !== 34) at += source.charCodeAt(at) === 92 ? 2 : 1;
        at++;
        tokens.push({ kind: "string", text: source.slice(start + 1, at - 1), at: start });
        continue;
    }
    if (isDigit(code)) {
      var value = 0;
      while (at < length && isDigit((code = source.charCodeAt(at)))) {
        value = value * 10 + (code - 48);
        at++;
      }
      tokens.push({ kind: "number", value: value, at: start });
    } else if (isLetter(code)) {
      while (at < length && (isLetter((code = source.charCodeAt(at))) || isDigit(code))) at++;
      var word = source.slice(start, at);
      tokens.push({ kind: keywords[word] === true ? "keyword" : "name", text: word, at: start });
    } else {
      at++;
      if (source.charCodeAt(at) === 61) at++;
      tokens.push({ kind: "operator", text: source.slice(start, at), at: start });
    }
  }
  return tokens;
}

function checksum(tokens) {
  var total = 0;
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i];
    total += token.kind.length + token.at;
    if (token.kind === "number") total += token.value;
    else total += token.text.length;
  }
  return total;
}

function run(rounds) {
  var line = 'function step(a, b) { var total = a * 12 + b; if (total >= 100) { return "big\\"one"; } else { while (a < 7) a += 1; } return total; }\n';
  var source = "";
  for (var i = 0; i < 40; i++) source += line;
  var total = 0;
  for (var round = 0; round < rounds; round++) total += checksum(tokenize(source));
  return total;
}

console.log(run(700));
