// macro code
export async function matchInFile(callExpression: BunAST.CallExpression) {
  const [filePathNode, matcherNode] = callExpression.arguments;
  let filePath: string;
  filePath = filePathNode.get();

  let matcher: RegExp;
  matcher = matcherNode.get();
  const file: string = await Bun.file(Bun.cwd + filePath).text();

  return (
    <array>
      {file
        .split("\n")
        .map(line => line.match(matcher))
        .filter(Boolean)
        .reverse()
        .map(line => (
          <string value={line[0]} />
        ))}
    </array>
  );
}
