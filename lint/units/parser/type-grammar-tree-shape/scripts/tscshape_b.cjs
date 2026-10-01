// node tscshape_b.cjs <forms.txt> <x.out> [max diffs]: the shape that the B+ mode printed (hooks of a sink that builds) against tsc's tree
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
const K = ts.SyntaxKind;
const KW = { [K.AnyKeyword]: "any", [K.UnknownKeyword]: "unknown", [K.StringKeyword]: "string", [K.NumberKeyword]: "number", [K.BigIntKeyword]: "bigint", [K.SymbolKeyword]: "symbol", [K.BooleanKeyword]: "boolean", [K.UndefinedKeyword]: "undefined", [K.NeverKeyword]: "never", [K.ObjectKeyword]: "object", [K.VoidKeyword]: "void" };
class Skip extends Error {}
function entity(n) { if (n.kind === K.Identifier) return n.text; if (n.kind === K.QualifiedName) return entity(n.left) + "." + n.right.text; throw new Skip("entity"); }
function shape(n) {
  switch (n.kind) {
    case K.ParenthesizedType: return `paren(${shape(n.type)})`;
    case K.UnionType: return `U[${n.types.map(shape).join(",")}]`;
    case K.IntersectionType: return `I[${n.types.map(shape).join(",")}]`;
    case K.ConditionalType: return `cond(${shape(n.checkType)};${shape(n.extendsType)};${shape(n.trueType)};${shape(n.falseType)})`;
    case K.TypeOperator: return `${n.operator === K.KeyOfKeyword ? "keyof" : n.operator === K.ReadonlyKeyword ? "readonly" : "unique"}(${shape(n.type)})`;
    case K.ArrayType: return `arr(${shape(n.elementType)})`;
    case K.IndexedAccessType: return `idx(${shape(n.objectType)})`;
    case K.TupleType: return "tuple";
    case K.TypeLiteral: case K.MappedType: return "object{}";
    case K.FunctionType: case K.ConstructorType: return "fn";
    case K.TemplateLiteralType: return "template";
    case K.TypeQuery: return "typeof";
    case K.ImportType: return n.isTypeOf ? "typeof import" : "import";
    case K.TypeReference: return entity(n.typeName);
    case K.LiteralType: return n.literal.kind === K.NullKeyword ? "null" : "lit";
    case K.ThisType: return "this";
    case K.TypePredicate: return "pred";
    case K.InferType: return n.typeParameter.constraint ? `infer(${shape(n.typeParameter.constraint)})` : "infer";
    default:
      if (KW[n.kind]) return KW[n.kind];
      throw new Skip(K[n.kind]);
  }
}
const dec = s => s.replace(/\\(n|\\)/g, (m, c) => c === "n" ? "\n" : "\\");
const forms = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const got = new Map(); let cur = null;
for (const line of fs.readFileSync(process.argv[3], "utf8").split("\n")) {
  if (line.startsWith("## ")) cur = line.slice(3);
  else if (line.startsWith("  B+ ")) got.set(cur, line.slice(5));
}
let same = 0, diff = 0, skipped = 0, tscRejects = 0, notWhole = 0; const diffs = [], rejected = [];
for (const f of forms) {
  const src = "type X = " + dec(f) + ";";
  const sf = ts.createSourceFile("a.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length || sf.statements.length !== 1 || sf.statements[0].kind !== K.TypeAliasDeclaration) { tscRejects++; continue; }
  let want;
  try { want = shape(sf.statements[0].type) || "_"; } catch (e) { if (e instanceof Skip) { skipped++; continue; } throw e; }
  const g = got.get(f); const m = /^ok:(\S+) @\d+ (\w+) E(\d+)/.exec(g || "");
  if (!m || m[2] !== "TEndOfFile" || m[3] !== "0") { notWhole++; rejected.push(f + "    => " + g); continue; }
  if (m[1] === want) same++; else { diff++; diffs.push(`${JSON.stringify(dec(f))}\n     tsc: ${want}\n     got: ${m[1]}`); }
}
console.log(`${process.argv[3]} (hooks of a sink that builds): same ${same}, different ${diff}, tsc parses but not taken whole ${notWhole}, tsc rejects ${tscRejects}, not compared ${skipped}`);
for (const d of diffs.slice(0, Number(process.argv[4] || 25))) console.log("  DIFF " + d);
if (process.argv[5]) for (const r of rejected.slice(0, Number(process.argv[5]))) console.log("  NOT TAKEN " + r.slice(0, 200));
