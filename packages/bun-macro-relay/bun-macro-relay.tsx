import { parse, print } from "graphql/index.js";
import { resolve } from "path";

//
// 1. Parse the GraphQL tag.
// 2. From the parsed GraphQL query, get the AST definition.
// 3. From the AST definition, inject an import to that file inside the artifact directory
// 4. (TODO) MD5 the printed source text
// 5. (TODO) At runtime, if md5 !== import.md5, then warn the user that the query has changed
//    but the file hasn't been updated so it must be reloaded.
// 6. Replace the TemplateLiteral with the default identifier from the injected import
let artifactDirectory: string = `__generated__`;

const { RELAY_ARTIFACT_DIRECTORY, BUN_MACRO_RELAY_ARTIFACT_DIRECTORY } =
  Bun.env;

if (RELAY_ARTIFACT_DIRECTORY) {
  artifactDirectory = RELAY_ARTIFACT_DIRECTORY;
}

if (BUN_MACRO_RELAY_ARTIFACT_DIRECTORY) {
  artifactDirectory = BUN_MACRO_RELAY_ARTIFACT_DIRECTORY;
}

artifactDirectory = resolve(artifactDirectory);

export function graphql(node) {
  let query;

  if (node instanceof <call />) {
    query = node.arguments[0].toString();
  } else if (node instanceof <template />) {
    query = node.toString();
  }

  if (typeof query !== "string" || query.length === 0) {
    throw new Error("BunMacroRelay: Unexpected empty graphql string.");
  }

  const ast = parse(query);

  if (ast.definitions.length === 0) {
    throw new Error("BunMacroRelay: Unexpected empty graphql tag.");
  }

  const definition = ast.definitions[0];

  if (
    definition.kind !== "FragmentDefinition" &&
    definition.kind !== "OperationDefinition"
  ) {
    throw new Error(
      `BunMacroRelay: Expected a fragment, mutation, query, or subscription, got "${definition.kind}"`,
    );
  }

  const graphqlDefinition = definition;

  const definitionName = graphqlDefinition.name && graphqlDefinition.name.value;
  if (!definitionName) {
    throw new Error("GraphQL operations and fragments must contain names");
  }

  const identifiername = `${definitionName}_$gql`;

  const importStmt = (
    <import
      default={identifiername}
      path={`${artifactDirectory}/${definitionName}.graphql`}
    />
  );

  return (
    <>
      <inject>{importStmt}</inject>
      <id to={importStmt.namespace[identifiername]} pure />
    </>
  );
}
