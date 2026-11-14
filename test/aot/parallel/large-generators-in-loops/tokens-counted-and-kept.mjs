// Loops over generators of hundreds of operations, whose bodies call nothing: they count, keep, break, continue, return, throw and leave an outer loop. What is printed is what plain Bun prints.
// STATISTIC: LargeGeneratorsInlinedIntoLoops >= 6
const unseen = x => [x][JSON.parse("0")];
const log = [];
const say = (...parts) => log.push(parts.map(p => (typeof p === "string" ? JSON.stringify(p) : Object.is(p, -0) ? "-0" : p && typeof p === "object" ? JSON.stringify(p) : String(p))).join(" "));
const tokens = (() => {
  var Word = /[a-z]\w*/y, Space = /\s+/y, Digits = /(\d+)(\.\d*)?/y, Mark = /\+\+|--|[-+*\/=(){}\[\];,.<>]/y, Text = /(['"])(?:(?!\1)[^\n])*(\1)?/y;
  return function* (input, { spaces = false, names = null } = {}) {
    let last = 0, match, depth = 0, before = "", stack = ["top"], sent;
    const { length } = input;
    try {
      while (last < length) {
        const mode = stack[stack.length - 1];
        switch (mode) {
          case "top":
          case "paren":
            Word.lastIndex = last;
            if ((match = Word.exec(input))) {
              last = Word.lastIndex;
              before = match[0];
              switch (match[0]) {
                case "if":
                case "while":
                  before = "?keyword";
              }
              sent = yield { type: names ? names[match[0]] || "name" : "word", value: match[0], depth };
              if (sent) say("sent", sent);
              continue;
            }
            Digits.lastIndex = last;
            if ((match = Digits.exec(input))) {
              last = Digits.lastIndex;
              before = match[0];
              yield { type: "digits", value: match[0], whole: match[1], fraction: match[2] !== undefined };
              continue;
            }
            Text.lastIndex = last;
            if ((match = Text.exec(input))) {
              last = Text.lastIndex;
              yield { type: "text", value: match[0], closed: match[2] !== undefined };
              if (match[2] === undefined) throw new SyntaxError("open text at " + last);
              continue;
            }
            break;
          case "bracket":
            if (input[last] === "]") {
              stack.pop();
              last++;
              yield { type: "end", value: "]" };
              continue;
            }
            yield { type: "inside", value: input[last] };
            last += 1;
            continue;
        }
        Mark.lastIndex = last;
        if ((match = Mark.exec(input))) {
          last = Mark.lastIndex;
          if (match[0] === "(") { stack.push("paren"); depth++; }
          else if (match[0] === ")") { if (stack.length > 1) stack.pop(); depth--; }
          else if (match[0] === "[") stack.push("bracket");
          yield { type: "mark", value: match[0], depth };
          if (before === "?keyword" && match[0] === ";") return "ended early";
          before = match[0];
          continue;
        }
        Space.lastIndex = last;
        if ((match = Space.exec(input))) {
          last = Space.lastIndex;
          if (spaces) yield { type: "space", value: match[0] };
          continue;
        }
        yield { type: "other", value: input[last] };
        last++;
      }
    } finally {
      say("closed", last, depth, before, stack.length);
    }
    return "end";
  };
})();
const counted = input => { let n = 0; for (const token of tokens(input)) n++; return n; };
const kept = (input, limit) => { const out = []; let n = 0; for (const token of tokens(input, { spaces: true })) { out[n++] = token; if (n === limit) break; } return out; };
const states = input => { const o = { n: 0, last: null, depth: 0 }; outer: for (let turn = 0; turn < 3; turn++) { for (const { type, value, depth = -1 } of tokens(input)) { o.n++; if (type === "digits") continue; o.last = value; o.depth = depth; if (value === "--") continue outer; if (value === "stop") break outer; } } return o; };
const found = (input, wanted) => { for (const token of tokens(input)) { if (token.value === wanted) return token; } return undefined; };
const thrown = input => { let n = 0; try { for (const token of tokens(input)) { n++; if (token.type === "other") throw token; } } catch (error) { return [n, error instanceof Error ? error.name + error.message : error.value]; } return n; };
const nothing = input => { let n = 0; for (const token of tokens(input, null)) n++; return n; };
const listed = input => { let all; for (let turn = 0; turn < 2; turn++) all = [...tokens(input, { names: { if: "keyword" } })]; return all; };
const inputs = unseen(["", "if (a1 + 23.5) b--;", "x = [1, 'two' ] ; while (y) stop", "'open", "a#b é 日 1.2.3", "((((]", "if;more", "[[]", "word"]);
for (const input of inputs) {
  for (const run of [counted, states, thrown, listed, nothing]) { try { say(run.name, run(input)); } catch (error) { say(run.name, error.name); } }
  for (const limit of unseen([0, 1, 3])) { try { say("kept", kept(input, limit)); } catch (error) { say(error.name); } }
  for (const wanted of unseen(["b", "stop", " "])) { try { say("found", found(input, wanted)); } catch (error) { say(error.name); } }
}
console.log(log.length);
console.log(log.join("\n"));
