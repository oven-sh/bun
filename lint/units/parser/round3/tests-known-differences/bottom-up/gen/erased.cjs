// sidecar-erased-statements/top-down/oracle.cjs as a module: run(text, file) gives { lines, kept, keptKinds, diags }. Made by the python lines of run.sh: do not edit.
// Prints, per input, the records that a lint parse has to make for the statements and class members that Bun's
// parse pass drops. Source of truth for kind, start and end: the tree of tsc (typescript 6.0.2).
// Which statements Bun drops, where the scope of a list starts and where a placeholder stays in the tree is a
// model of src/js_parser/parse (see MODEL below); offsets are bytes for ASCII inputs.
// usage: node oracle.cjs inputs.json [more.json...]     (TYPESCRIPT=<path> overrides the package)
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;


function run(text, file) {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out = [];
  const start = n => n.getStart(sf);
  const mods = n => (n.modifiers || []).filter(m => m.kind !== K.Decorator);
  const decorators = n => (n.modifiers || []).filter(m => m.kind === K.Decorator);
  const has = (n, k) => mods(n).some(m => m.kind === k);
  const tok = (n, k) => { const c = n.getChildren(sf).find(c => c.kind === k); return c ? c.getStart(sf) : -1; };
  const isFnLike = n => [K.FunctionDeclaration, K.FunctionExpression, K.ArrowFunction, K.MethodDeclaration, K.Constructor, K.GetAccessor, K.SetAccessor].includes(n.kind);

  // MODEL: is this statement dropped by Bun? `ambient`: the list is parsed with is_typescript_declare.
  // `inNamespace`: the list is the body of a namespace (StatementScope::Namespace).
  const declared = (n, ambient) => ambient || has(n, K.DeclareKeyword);
  function hasNonLocalExportDeclare(stmts, ambient) {
    return stmts.some(s => [K.ClassDeclaration, K.FunctionDeclaration, K.EnumDeclaration].includes(s.kind) && has(s, K.ExportKeyword) && declared(s, ambient));
  }
  function moduleErased(m, ambient) {
    if (declared(m, ambient) || (m.flags & ts.NodeFlags.GlobalAugmentation)) return true;
    if (!m.body) return true;
    if (m.body.kind === K.ModuleDeclaration) return false; // one statement, the inner part, placeholder or not
    const kept = m.body.statements.filter(s => keptInList(s, false, true));
    return kept.every(s => s.kind === K.ImportEqualsDeclaration && !has(s, K.ExportKeyword)) && !hasNonLocalExportDeclare(m.body.statements, false);
  }
  function standIn(n, ambient, inNamespace) {
    return n.kind === K.VariableStatement && has(n, K.DeclareKeyword) && has(n, K.ExportKeyword) && inNamespace;
  }
  function erased(n, ambient, inNamespace) {
    switch (n.kind) {
      case K.InterfaceDeclaration: case K.TypeAliasDeclaration: case K.NamespaceExportDeclaration: return true;
      case K.FunctionDeclaration: return declared(n, ambient) || !n.body;
      case K.ClassDeclaration: case K.EnumDeclaration: return declared(n, ambient);
      case K.VariableStatement: return has(n, K.DeclareKeyword) && !standIn(n, ambient, inNamespace);
      case K.ModuleDeclaration: return moduleErased(n, ambient);
      case K.ImportDeclaration: {
        const c = n.importClause; if (!c) return false;
        if (c.isTypeOnly) return true;
        const nb = c.namedBindings;
        return !c.name && !!nb && nb.kind === K.NamedImports && nb.elements.length > 0 && nb.elements.every(e => e.isTypeOnly);
      }
      case K.ImportEqualsDeclaration: return n.isTypeOnly || declared(n, ambient);
      case K.ExportDeclaration: {
        if (n.isTypeOnly) return true;
        const c = n.exportClause;
        return !!c && c.kind === K.NamedExports && c.elements.length > 0 && c.elements.every(e => e.isTypeOnly);
      }
      case K.ExpressionStatement: return n.expression.kind === K.Identifier && n.expression.text === "declare" && text[n.end - 1] === ";";
      default: return false;
    }
  }
  function memberErased(m) {
    switch (m.kind) {
      case K.IndexSignature: return true;
      case K.MethodDeclaration: case K.Constructor: case K.GetAccessor: case K.SetAccessor:
        return !m.body || has(m, K.AbstractKeyword) || has(m, K.DeclareKeyword);
      case K.PropertyDeclaration:
        return (has(m, K.AbstractKeyword) || has(m, K.DeclareKeyword)) && (decorators(m).length === 0 || has(m, K.AccessorKeyword));
      default: return false;
    }
  }
  // A statement that stays in the list that Bun builds. The directive prologue is handled by the caller.
  const keptInList = (s, ambient, inNamespace) => !erased(s, ambient, inNamespace) && s.kind !== K.EmptyStatement;

  const nameOf = n => n.name ? (n.name.kind === K.StringLiteral ? JSON.stringify(n.name.text) : n.name.getText(sf)) + "@[" + start(n.name) + "," + n.name.end + ")" : "-";
  const bindingNames = d => d.name.kind === K.Identifier ? [d.name.text] : d.name.elements.flatMap(e => e.kind === K.OmittedExpression ? [] : bindingNames(e));
  function flags(n, ambient, extra) {
    const f = [];
    if (has(n, K.ExportKeyword)) f.push("export");
    if (has(n, K.DefaultKeyword)) f.push("default");
    if (has(n, K.DeclareKeyword)) f.push("declare");
    if (ambient || has(n, K.DeclareKeyword)) f.push("ambient");
    if (has(n, K.AbstractKeyword)) f.push("abstract");
    if (has(n, K.StaticKeyword)) f.push("static");
    return f.concat(extra || []).join(" ");
  }
  function detail(n, ambient, inNamespace) {
    switch (n.kind) {
      case K.InterfaceDeclaration: return ["interface", `name=${nameOf(n)} members=${n.members.length}`];
      case K.TypeAliasDeclaration: return ["type-alias", `name=${nameOf(n)}`];
      case K.NamespaceExportDeclaration: return ["export-as-namespace", `name=${nameOf(n)}`];
      case K.FunctionDeclaration: return ["function", `name=${nameOf(n)} params=${n.parameters.length} body=${n.body ? "yes" : "no"}${has(n, K.AsyncKeyword) ? " async" : ""}${n.asteriskToken ? " generator" : ""}`];
      case K.ClassDeclaration: return ["class", `name=${nameOf(n)} kept-members=${n.members.filter(m => !memberErased(m) && m.kind !== K.SemicolonClassElement).length} decorators=${decorators(n).length}`];
      case K.EnumDeclaration: return ["enum", `name=${nameOf(n)} members=${n.members.length}${has(n, K.ConstKeyword) ? " const" : ""}`];
      case K.VariableStatement: {
        const l = n.declarationList, kind = l.flags & ts.NodeFlags.Const ? "const" : l.flags & ts.NodeFlags.Let ? "let" : "var";
        return ["var", `kind=${kind} names=${l.declarations.flatMap(bindingNames).join(",")}`];
      }
      case K.ModuleDeclaration: {
        const kw = n.flags & ts.NodeFlags.GlobalAugmentation ? "global" : n.flags & ts.NodeFlags.Namespace ? "namespace" : "module";
        const global = !!(n.flags & ts.NodeFlags.GlobalAugmentation);
        let stmts = 0;
        if (n.body && n.body.kind === K.ModuleBlock) stmts = keptStatements(n.body.statements, declared(n, ambient) || global, global ? inNamespace : true).length; else if (n.body) stmts = 1;
        return ["module", `keyword=${kw} name=${nameOf(n)} stmts=${stmts} body=${n.body ? "yes" : "no"}`];
      }
      case K.ImportDeclaration: {
        const c = n.importClause, nb = c.namedBindings;
        const els = nb && nb.kind === K.NamedImports ? nb.elements : [];
        return ["import", `default=${c.name ? c.name.text + "@" + start(c.name) : "-"} star=${nb && nb.kind === K.NamespaceImport ? nb.name.text + "@" + start(nb.name) : "-"} items=${els.filter(e => !e.isTypeOnly).length}/${els.length} path=${JSON.stringify(n.moduleSpecifier.text)}@[${start(n.moduleSpecifier)},${n.moduleSpecifier.end})${n.attributes ? " attributes=" + n.attributes.elements.length : ""}`];
      }
      case K.ImportEqualsDeclaration: {
        const r = n.moduleReference;
        return ["import-equals", `name=${nameOf(n)} ref=${r.kind === K.ExternalModuleReference ? "require(" + JSON.stringify(r.expression.text) + "@" + start(r.expression) + ")" : r.getText(sf) + "@" + start(r)}`];
      }
      case K.ExportDeclaration: {
        const c = n.exportClause, els = c && c.kind === K.NamedExports ? c.elements : [];
        return ["export", `${!c ? "star" : c.kind === K.NamespaceExport ? "star-as=" + c.name.getText(sf) + "@" + start(c.name) : "items=" + els.filter(e => !e.isTypeOnly).length + "/" + els.length} path=${n.moduleSpecifier ? JSON.stringify(n.moduleSpecifier.text) + "@[" + start(n.moduleSpecifier) + "," + n.moduleSpecifier.end + ")" : "-"}${n.attributes ? " attributes=" + n.attributes.elements.length : ""}`];
      }
      case K.ExpressionStatement: return ["declare-empty", ""];
    }
    return ["unknown", K[n.kind]];
  }
  function typeOnlyFlag(n) {
    return (n.kind === K.ImportDeclaration && n.importClause.isTypeOnly) || ((n.kind === K.ExportDeclaration || n.kind === K.ImportEqualsDeclaration) && n.isTypeOnly) ? ["type-only"] : [];
  }
  // The Loc that Bun gives the placeholder of the statement.
  function marker(n, nestedDot) {
    if (nestedDot >= 0) return nestedDot;
    const d = mods(n).find(m => m.kind === K.DeclareKeyword);
    if (d) return start(d);
    const exp = mods(n).find(m => m.kind === K.ExportKeyword), def = has(n, K.DefaultKeyword), asy = mods(n).find(m => m.kind === K.AsyncKeyword);
    const after = () => { const last = mods(n).filter(m => m.kind === K.ExportKeyword || m.kind === K.DefaultKeyword).pop(); return ts.skipTrivia(text, last ? last.end : n.pos); };
    switch (n.kind) {
      case K.TypeAliasDeclaration: case K.NamespaceExportDeclaration: case K.ExportDeclaration: return exp ? start(exp) : start(n);
      case K.FunctionDeclaration: return asy && exp ? start(exp) : after();
      default: return after();
    }
  }
  function record(n, place, ambient, opts) {
    opts = opts || {};
    const [kind, d] = detail(n, ambient, !!opts.inNamespace);
    const extra = [...typeOnlyFlag(n), ...(opts.nested ? ["nested"] : []), ...(opts.standIn ? ["stand-in"] : []),
      ...(n.kind === K.FunctionDeclaration && !n.body ? ["no-body"] : []), ...(n.kind === K.ModuleDeclaration && !n.body ? ["no-body"] : [])];
    const f = flags(n, ambient, extra);
    out.push([start(n), `${kind} [${start(n)},${n.end}) ${place}${f ? " " + f : ""}${d ? " " + d : ""}`]);
  }
  function memberRecord(m, place) {
    const kind = { [K.IndexSignature]: "index-signature", [K.MethodDeclaration]: "method", [K.Constructor]: "constructor", [K.GetAccessor]: "getter", [K.SetAccessor]: "setter", [K.PropertyDeclaration]: "property" }[m.kind];
    const f = flags(m, false, []).replace(/ ?ambient/, "").trim();
    const key = m.name ? `key=${m.name.getText(sf)}@${m.name.kind === K.ComputedPropertyName ? start(m.name.expression) : start(m.name)}` : m.kind === K.IndexSignature ? `open=${m.parameters.pos - 1}` : "";
    const body = m.kind === K.IndexSignature || m.kind === K.PropertyDeclaration ? "" : ` body=${m.body ? "yes" : "no"}`;
    out.push([start(m), `member ${kind} [${start(m)},${m.end}) ${place}${f ? " " + f : ""} ${key}${body} decorators=${decorators(m).length}`.replace(/  +/g, " ")]);
  }
  // Statements of a list in the order Bun keeps them, without the directives it removes.
  function keptStatements(stmts, ambient, inNamespace) {
    const kept = []; let prologue = true;
    for (const s of stmts) {
      if (erased(s, ambient, inNamespace)) continue;
      if (prologue) {
        prologue = false;
        if (s.kind === K.ExpressionStatement && s.expression.kind === K.StringLiteral) {
          prologue = true;
          if (s.expression.text === "use strict" || s.expression.text === "use asm") continue;
        }
      }
      if (s.kind === K.EmptyStatement) continue;
      kept.push(s);
    }
    return kept;
  }
  function statement(s, ambient, inNamespace, place) {
    const e = erased(s, ambient, inNamespace);
    if (e) record(s, place || `in-tree@${marker(s, -1)}`, ambient, { inNamespace });
    else if (standIn(s, ambient, inNamespace)) record(s, `in-tree@${marker(s, -1)}`, ambient, { standIn: true, inNamespace });
    descend(s, ambient, inNamespace, e);
  }
  function list(stmts, owner, ambient, inNamespace) {
    const kept = new Set(keptStatements(stmts, ambient, inNamespace)); let k = 0;
    for (const s of stmts) {
      statement(s, ambient, inNamespace, `${owner}#${k}`);
      if (kept.has(s)) k++;
    }
  }
  // The Loc of the scope that Bun pushes for a statement list.
  const moduleLoc = m => m.parent.kind === K.ModuleDeclaration ? tok(m.parent, K.DotToken) : Math.max(tok(m, K.NamespaceKeyword), tok(m, K.ModuleKeyword));
  const blockLoc = b => b.parent.kind === K.TryStatement ? (b.parent.tryBlock === b ? start(b.parent) : tok(b.parent, K.FinallyKeyword)) : start(b);
  // Walks what is inside a node: its lists, its class bodies, the statements that no list owns.
  function descend(n, ambient, inNamespace, isErased) {
    switch (n.kind) {
      case K.ModuleDeclaration: {
        const b = n.body; if (!b) return;
        const global = !!(n.flags & ts.NodeFlags.GlobalAugmentation);
        const amb = declared(n, ambient) || global;
        if (b.kind === K.ModuleBlock) return list(b.statements, isErased ? `child@${start(n)}` : `scope@${moduleLoc(n)}`, amb, global ? inNamespace : true);
        // dotted name: the inner part is the one statement of the outer part, placeholder or not
        const innerErased = moduleErased(b, amb);
        if (innerErased) record(b, `in-tree@${tok(n, K.DotToken)}`, amb, { nested: true, inNamespace: true });
        return descend(b, amb, true, innerErased);
      }
      case K.Block: return list(n.statements, `scope@${blockLoc(n)}`, false, false);
      case K.ClassDeclaration: case K.ClassExpression: {
        const open = tok(n, K.OpenBraceToken); let k = 0;
        for (const h of n.heritageClauses || []) descend(h, false, false, false);
        for (const m of n.members) {
          if (m.kind === K.SemicolonClassElement) continue;
          if (memberErased(m)) memberRecord(m, `scope@${open}#${k}`); else k++;
          descend(m, false, false, false);
        }
        return;
      }
      default:
        ts.forEachChild(n, c => ts.isStatement(c) && c.kind !== K.Block ? statement(c, false, false, null) : descend(c, false, false, false));
    }
  }
  const isDts = /\.d\.[cm]?ts$/.test(file);
  list(sf.statements, "module", isDts, false);
  out.sort((a, b) => a[0] - b[0]);
  const kept = keptStatements(sf.statements, isDts, false).length;
  return { lines: out.map(o => o[1]), kept, keptNodes: keptStatements(sf.statements, isDts, false), diags: sf.parseDiagnostics.map(d => `TS${d.code}@${d.start}+${d.length} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`) };
}

module.exports = { run };
