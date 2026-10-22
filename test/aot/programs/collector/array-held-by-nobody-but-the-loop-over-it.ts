// Nothing in the loop of `count` changes the storage of `tokens`, so compiled code reads its address once in front of the loop, and nobody but `count` holds the array. The collector reaches the tokens through the array alone.
interface Token { kind: string; text: string; position: number }

function lex(source: string): Token[] {
  const tokens: Token[] = [];
  for (let i = 0; i + 3 <= source.length; i += 3) tokens.push({ kind: "id", text: source.slice(i, i + 3), position: i });
  return tokens;
}

function count(tokens: Token[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) if (token.kind === "id") counts.set(token.text, (counts.get(token.text) ?? 0) + 1);
  return counts;
}

function countByIndex(tokens: Token[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < tokens.length; i++) counts.set(tokens[i].text, (counts.get(tokens[i].text) ?? 0) + 1);
  return counts;
}

let source = "";
for (let i = 0; i < 400; i++) source += "ab" + (i % 10);
let sizes = 0;
for (let round = 0; round < 20; round++) sizes += count(lex(source)).size + countByIndex(lex(source)).size;
console.log(sizes);
