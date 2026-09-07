import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const manifestPath = resolve(process.env.MDX_BENCH_MANIFEST || process.argv[2] || "manifest.json");
const deps = createRequire(join(resolve(process.env.MDX_BENCH_DEPS || import.meta.dirname), "package.json"));
const [mdx, gfm, frontmatter, mdxFrontmatter, acorn, jsx] = await Promise.all(
  ["@mdx-js/mdx", "remark-gfm", "remark-frontmatter", "remark-mdx-frontmatter", "acorn", "acorn-jsx"].map(
    name => import(pathToFileURL(deps.resolve(name)).href),
  ),
);
const parser = acorn.Parser.extend(jsx.default());
function walk(node, predicate) {
  if (!node || typeof node !== "object") return;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    for (const child of Array.isArray(value) ? value : [value]) {
      const found = walk(child, predicate);
      if (found) return found;
    }
  }
}
function expression(node) {
  if (node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expression);
  return Object.fromEntries(
    Object.keys(node)
      .sort()
      .filter(key => !["start", "end", "loc", "raw", "extra"].includes(key))
      .map(key => [key, expression(node[key])]),
  );
}
function tagName(node) {
  if (node.type === "JSXIdentifier") return node.name;
  if (node.type === "JSXMemberExpression")
    return node.object.name?.startsWith("_components")
      ? tagName(node.property)
      : `${tagName(node.object)}.${tagName(node.property)}`;
  if (node.type === "JSXNamespacedName") return `${tagName(node.namespace)}:${tagName(node.name)}`;
  throw new Error(`Unexpected JSX name: ${node.type}`);
}
function children(nodes, preserve) {
  const result = [];
  for (const node of nodes) {
    const value = canonical(node, preserve);
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item == null) continue;
      if (typeof item === "string" && typeof result.at(-1) === "string") result[result.length - 1] += item;
      else result.push(item);
    }
  }
  return result
    .map(item => (typeof item === "string" && !preserve ? item.replace(/\s+/g, " ") : item))
    .filter(item => typeof item !== "string" || preserve || item.trim() !== "");
}
function canonical(node, preserve = false) {
  if (node.type === "JSXFragment") return children(node.children, preserve);
  if (node.type === "JSXText") return node.value;
  if (node.type === "JSXExpressionContainer") {
    if (node.expression.type === "JSXEmptyExpression") return null;
    if (node.expression.type === "Literal" && typeof node.expression.value === "string") return node.expression.value;
    return { expression: expression(node.expression) };
  }
  if (node.type !== "JSXElement") throw new Error(`Unexpected content node: ${node.type}`);
  const tag = tagName(node.openingElement.name);
  const attrs = node.openingElement.attributes
    .map(attribute => {
      if (attribute.type === "JSXSpreadAttribute") return ["...", expression(attribute.argument)];
      const value =
        attribute.value === null
          ? true
          : attribute.value.type === "Literal"
            ? attribute.value.value
            : expression(attribute.value.expression);
      return [tagName(attribute.name), value];
    })
    .sort((a, b) => a[0].localeCompare(b[0]));
  return { tag, attrs, children: children(node.children, preserve || tag === "pre" || tag === "code") };
}
function firstDifference(a, b, path = "$root") {
  if (JSON.stringify(a) === JSON.stringify(b)) return;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return path;
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const difference = firstDifference(a[key], b[key], `${path}.${key}`);
    if (difference) return difference;
  }
}
function inspect(code, native, hasFrontmatter) {
  const ast = parser.parse(code, { ecmaVersion: "latest", sourceType: "module" });
  const content = native
    ? walk(
        ast.body.find(node => node.type === "ExportDefaultDeclaration"),
        node => node.type === "VariableDeclarator" && node.init?.type === "JSXFragment",
      )?.init
    : walk(
        walk(ast, node => node.type === "FunctionDeclaration" && node.id.name === "_createMdxContent"),
        node => node.type === "ReturnStatement",
      )?.argument;
  if (!content) throw new Error("Could not locate the compiler's content expression");
  const namedExports = ast.body.filter(node => node.type === "ExportNamedDeclaration");
  const isFrontmatter = node =>
    hasFrontmatter &&
    node.declaration?.declarations?.length === 1 &&
    node.declaration.declarations[0].id.name === "frontmatter";
  return {
    content: children([content], false),
    imports: ast.body.filter(node => node.type === "ImportDeclaration").map(expression),
    namedExports: namedExports.filter(node => !isFrontmatter(node)).map(expression),
    frontmatter: namedExports.filter(isFrontmatter).map(expression),
  };
}
const results = [];
for (const fixture of JSON.parse(readFileSync(manifestPath, "utf8"))) {
  const source = readFileSync(resolve(dirname(manifestPath), fixture.path), "utf8");
  try {
    const remarkPlugins = [gfm.default];
    const hasFrontmatter = /^---\r?\n/.test(source);
    if (hasFrontmatter) remarkPlugins.push(frontmatter.default, [mdxFrontmatter.default, { name: "frontmatter" }]);
    const native = inspect(Bun.mdx.compile(source, { permissiveAutolinks: true }), true, hasFrontmatter);
    const reference = inspect(
      String(mdx.compileSync(source, { jsx: true, development: false, tableCellAlignToStyle: false, remarkPlugins })),
      false,
      hasFrontmatter,
    );
    const differencePath = firstDifference(native, reference);
    results.push({
      id: fixture.id,
      equal: !differencePath,
      differencePath,
      sha256: createHash("sha256").update(source).digest("hex"),
    });
  } catch (error) {
    results.push({ id: fixture.id, equal: false, error: error.name });
  }
}
const output = JSON.stringify(results, null, 2) + "\n";
if (process.argv[3]) writeFileSync(resolve(process.argv[3]), output);
process.stdout.write(output);
if (results.some(result => !result.equal)) process.exitCode = 1;
