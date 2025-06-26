const result = Bun.spawnSync(
  ["clang", "-Xclang", "-ast-dump=json", "-fsyntax-only", "src/bun.js/bindings/InspectorHTTPServerAgent.cpp"],
  {
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const ast = JSON.parse(result.stdout.toString("utf-8")) as ASTNode;

type ASTNode = {
  id: string;
  loc: unknown;
  range: unknown;
  inner: ASTNode[];
} & (
  | {
      kind: "FunctionDecl";
      name?: string;
    }
  | {
      kind: "other";
    }
);

const functionNames = new Set<string>();
function processNode(node: ASTNode) {
  if (node.kind === "FunctionDecl" && node.name) {
    functionNames.add(node.name);
    if (node.name === "Bun__HTTPServerAgent__notifyServerStopped") {
      console.log(node);
    }
  }
  for (const child of node.inner ?? []) {
    processNode(child);
  }
}

processNode(ast);
console.log(functionNames);
