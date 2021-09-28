// macro code
export function matchInFile(callExpression: BunAST.CallExpression) {
  const [filePathNode, matcherNode] = callExpression.arguments;
  let filePath: string;
  filePath = filePathNode.get();

  let matcher: RegExp;
  matcher = matcherNode.get();
  const file: string = Bun.readFile(Bun.cwd + filePath);

  return (
    <array>
      {file
        .split("\n")
        .map((line) => line.match(matcher))
        .filter(Boolean)
        .reverse()
        .map((line) => (
          <string value={line[0]} />
        ))}
    </array>
  );
}
