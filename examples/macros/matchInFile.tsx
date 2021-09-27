// macro code
export function matchInFile(callExpression) {
  const [filePathNode, matcherNode] = callExpression.arguments;
  const filePath: string = filePathNode.get();
  const matcher: RegExp = matcherNode.get();
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
