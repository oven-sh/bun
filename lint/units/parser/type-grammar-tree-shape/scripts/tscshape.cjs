// node tscshape.cjs <forms.txt> <x.out> : compares the shape that the S+ mode printed with the shape of tsc's tree
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
const K = ts.SyntaxKind;
const RESERVED = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with".split(" "));
const NOREF = new Set(["abstract", "asserts", "unique", "keyof", "readonly", "infer"]);
const KW = { [K.AnyKeyword]: "any", [K.UnknownKeyword]: "unknown", [K.StringKeyword]: "string", [K.NumberKeyword]: "number", [K.BigIntKeyword]: "bigint", [K.SymbolKeyword]: "symbol", [K.BooleanKeyword]: "boolean", [K.UndefinedKeyword]: "undefined", [K.NeverKeyword]: "never", [K.ObjectKeyword]: "object", [K.VoidKeyword]: "void" };
class Skip extends Error {}
function entity(n) { // first name as the sink sees it, then ".name" for each further name
  if (n.kind === K.Identifier) return RESERVED.has(n.text) || NOREF.has(n.text) ? "" : (KW_NAMES.has(n.text) ? n.text : n.text);
  if (n.kind === K.QualifiedName) return entity(n.left) + "." + n.right.text;
  throw new Skip("entity " + K[n.kind]);
}
const KW_NAMES = new Set(Object.values(KW));
function fold(types, op) { let acc = shape(types[0]); for (let i = 1; i < types.length; i++) acc = `(${acc}${op}${shape(types[i])})`; return acc; }
function shape(n) {
  switch (n.kind) {
    case K.ParenthesizedType: return `paren(${shape(n.type)})`;
    case K.UnionType: return fold(n.types, "|");
    case K.IntersectionType: return fold(n.types, "&");
    case K.ConditionalType: return `cond(${shape(n.checkType)};${shape(n.trueType)};${shape(n.falseType)})`;
    case K.TypeOperator: return n.operator === K.KeyOfKeyword ? "keyof" : n.operator === K.ReadonlyKeyword ? "readonly" : "";
    case K.ArrayType: return `arr(${shape(n.elementType)})`;
    case K.IndexedAccessType: return `idx(${shape(n.objectType)})`;
    case K.TupleType: return "tuple";
    case K.TypeLiteral: case K.MappedType: return "object{}";
    case K.FunctionType: case K.ConstructorType: return "fn";
    case K.TemplateLiteralType: return "template";
    case K.TypeQuery: return "typeof";
    case K.ImportType: return (n.isTypeOf ? "typeof" : "") + (n.qualifier ? "." + entityNames(n.qualifier).join(".") : "");
    case K.TypeReference: return entity(n.typeName);
    case K.LiteralType: return n.literal.kind === K.NullKeyword ? "null" : "lit";
    case K.ThisType: return "this";
    case K.TypePredicate: return n.parameterName.kind === K.ThisType && !n.assertsModifier ? "" : (() => { throw new Skip("predicate"); })();
    case K.InferType: return "";
    default:
      if (KW[n.kind]) return KW[n.kind];
      throw new Skip(K[n.kind]);
  }
}
function entityNames(n) { return n.kind === K.Identifier ? [n.text] : [...entityNames(n.left), n.right.text]; }
const dec = s => s.replace(/\\(n|\\)/g, (m, c) => c === "n" ? "\n" : "\\");
const forms = fs.readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean);
const got = new Map(); let cur = null;
for (const line of fs.readFileSync(process.argv[3], "utf8").split("\n")) {
  if (line.startsWith("## ")) cur = line.slice(3);
  else if (line.startsWith("  S+ ")) got.set(cur, line.slice(5));
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
console.log(`${process.argv[3]}: same ${same}, different ${diff}, tsc parses but this grammar does not take the whole type ${notWhole}, tsc rejects ${tscRejects}, not compared ${skipped}`);
for (const d of diffs.slice(0, Number(process.argv[4] || 25))) console.log("  DIFF " + d);
if (process.argv[5]) for (const r of rejected.slice(0, Number(process.argv[5]))) console.log("  NOT TAKEN " + r.slice(0, 200));
