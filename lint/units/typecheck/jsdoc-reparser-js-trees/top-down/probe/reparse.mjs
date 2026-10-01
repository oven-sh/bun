// Probe (route A): a port of typescript-go's internal/parser/reparser.go as a pass over a finished tree.
// Input: the tree that convert.mjs makes from a TypeScript 6.0.2 dump (nodes carry their JSDoc in `jsdoc`).
// Each function below has the name of the function of reparser.go that it follows.
import { GOF, externalModuleIndicator } from "./convert.mjs";

export const CONTEXT_MASK = (GOF.DisallowInContext | GOF.DisallowConditionalTypesContext | GOF.YieldContext | GOF.DecoratorContext | GOF.AwaitContext | GOF.JavaScriptFile | GOF.InWithStatement | GOF.Ambient) >>> 0;
const MOD = { PublicKeyword: 1 << 0, PrivateKeyword: 1 << 1, ProtectedKeyword: 1 << 2, ReadonlyKeyword: 1 << 3, OverrideKeyword: 1 << 4, ExportKeyword: 1 << 5,
  AbstractKeyword: 1 << 6, DeclareKeyword: 1 << 7, StaticKeyword: 1 << 8, AccessorKeyword: 1 << 9, AsyncKeyword: 1 << 10, DefaultKeyword: 1 << 11,
  ConstKeyword: 1 << 12, InKeyword: 1 << 13, OutKeyword: 1 << 14, Decorator: 1 << 15 };

export const stats = new Map();
const hit = k => stats.set(k, (stats.get(k) ?? 0) + 1);

function mk(kind) { return { kind, pos: -1, end: -1, flags: 0, scalars: new Map(), children: new Map(), jsdoc: [], parent: null }; }
const get = (n, name) => n?.children.get(name);
const nodesOf = (n, name) => n?.children.get(name)?.nodes ?? [];
const textOf = n => n?.scalars.get("Text")?.s ?? "";
function setChild(n, name, v) { if (v === undefined || v === null) n.children.delete(name); else n.children.set(name, v); }
function newList(pos, end, nodes, extra) { return { list: true, pos, end, nodes, ...extra }; }
function newModifierList(pos, end, nodes) { let f = 0; for (const m of nodes) f |= MOD[m.kind] ?? 0; return { list: true, modifiers: true, modifierFlags: f, pos, end, nodes }; }

function forEachChild(n, cb) {
  for (const c of n.children.values()) { if (c.list) for (const x of c.nodes) cb(x); else cb(c); }
}
export function setParentInChildren(n) {
  forEachChild(n, c => { c.parent = n; setParentInChildren(c); });
}
function overrideParentInImmediateChildren(n) { forEachChild(n, c => { c.parent = n; }); }

// ast.NodeFactory.DeepCloneReparse: every node of the subtree is copied with its range and flags.
function cloneTree(n) {
  const c = { kind: n.kind, pos: n.pos, end: n.end, flags: n.flags, scalars: new Map(n.scalars), children: new Map(), jsdoc: [], parent: null, cloneOf: n };
  for (const [name, v] of n.children) {
    if (v.list) c.children.set(name, { ...v, nodes: v.nodes.map(cloneTree) });
    else c.children.set(name, cloneTree(v));
  }
  return c;
}
function deepCloneReparse(n) {
  if (!n) return undefined;
  const c = cloneTree(n);
  setParentInChildren(c);
  c.flags = (c.flags | GOF.Reparsed) >>> 0;
  return c;
}
function deepCloneReparseModifiers(list) {
  if (!list) return undefined;
  return { ...list, nodes: list.nodes.map(cloneTree) };
}

const ID_START = /^[\p{ID_Start}$_]$/u, ID_PART = /^[\p{ID_Continue}$_\u200c\u200d]$/u;
const isIdentifierStart = ch => ID_START.test(ch);
const isIdentifierPart = ch => ID_PART.test(ch);
function isValidIdentifier(s) {
  if (s.length === 0) return false;
  let i = 0;
  for (const ch of s) { if (i === 0 ? !isIdentifierStart(ch) : !isIdentifierPart(ch)) return false; i++; }
  return true;
}

const FUNCTION_LIKE = new Set(["MethodSignature", "CallSignature", "JSDocSignature", "ConstructSignature", "IndexSignature", "FunctionType", "ConstructorType",
  "Constructor", "FunctionExpression", "ArrowFunction", "MethodDeclaration", "GetAccessor", "SetAccessor", "FunctionDeclaration"]);
const isFunctionLike = n => !!n && FUNCTION_LIKE.has(n.kind);
const ASSIGNMENT_OPS = new Set(["EqualsToken", "PlusEqualsToken", "MinusEqualsToken", "AsteriskAsteriskEqualsToken", "AsteriskEqualsToken", "SlashEqualsToken", "PercentEqualsToken",
  "AmpersandEqualsToken", "BarEqualsToken", "CaretEqualsToken", "LessThanLessThanEqualsToken", "GreaterThanGreaterThanGreaterThanEqualsToken", "GreaterThanGreaterThanEqualsToken",
  "BarBarEqualsToken", "AmpersandAmpersandEqualsToken", "QuestionQuestionEqualsToken"]);
const LHS_KINDS = new Set(["PropertyAccessExpression", "ElementAccessExpression", "NewExpression", "CallExpression", "JsxElement", "JsxSelfClosingElement", "JsxFragment", "TaggedTemplateExpression",
  "ArrayLiteralExpression", "ParenthesizedExpression", "ObjectLiteralExpression", "ClassExpression", "FunctionExpression", "Identifier", "PrivateIdentifier", "RegularExpressionLiteral",
  "NumericLiteral", "BigIntLiteral", "StringLiteral", "NoSubstitutionTemplateLiteral", "TemplateExpression", "FalseKeyword", "NullKeyword", "ThisKeyword", "TrueKeyword", "SuperKeyword",
  "NonNullExpression", "ExpressionWithTypeArguments", "MetaProperty", "ImportKeyword", "MissingDeclaration"]);
function isAssignmentExpression(n, excludeCompound) {
  if (n?.kind !== "BinaryExpression") return false;
  const op = get(n, "OperatorToken").kind;
  return (op === "EqualsToken" || (!excludeCompound && ASSIGNMENT_OPS.has(op))) && LHS_KINDS.has(get(n, "Left").kind);
}
function getRightMostAssignedExpression(n) { while (isAssignmentExpression(n, false)) n = get(n, "Right"); return n; }
const isIdentifier = n => n?.kind === "Identifier";
const isAccessExpression = n => n?.kind === "PropertyAccessExpression" || n?.kind === "ElementAccessExpression";
const isStringOrNumericLiteralLike = n => n?.kind === "StringLiteral" || n?.kind === "NoSubstitutionTemplateLiteral" || n?.kind === "NumericLiteral";
function skipParentheses(n) { while (n?.kind === "ParenthesizedExpression") n = get(n, "Expression"); return n; }
function getElementOrPropertyAccessName(n) {
  if (n.kind === "PropertyAccessExpression") return isIdentifier(get(n, "name")) ? get(n, "name") : undefined;
  const arg = skipParentheses(get(n, "ArgumentExpression"));
  return isStringOrNumericLiteralLike(arg) ? arg : undefined;
}
const isModuleIdentifier = n => isIdentifier(n) && textOf(n) === "module";
const isExportsIdentifier = n => isIdentifier(n) && textOf(n) === "exports";
function isModuleExportsAccessExpression(n) {
  if (isAccessExpression(n) && isModuleIdentifier(get(n, "Expression"))) { const name = getElementOrPropertyAccessName(n); return !!name && textOf(name) === "exports"; }
  return false;
}
function isEntityNameExpressionEx(n, allowJS) {
  return isIdentifier(n) || (n?.kind === "PropertyAccessExpression" && isIdentifier(get(n, "name")) && isEntityNameExpressionEx(get(n, "Expression"), allowJS)) ||
    (allowJS && (n?.kind === "ThisKeyword" || (n?.kind === "ElementAccessExpression" && isStringOrNumericLiteralLike(get(n, "ArgumentExpression")) && isEntityNameExpressionEx(get(n, "Expression"), allowJS))));
}
// ast.GetAssignmentDeclarationKind for a binary expression in a JavaScript file: true when the kind is not None.
function isAssignmentDeclaration(bin) {
  const left = get(bin, "Left");
  if (get(bin, "OperatorToken").kind !== "EqualsToken" || !isAccessExpression(left)) return false;
  if (isModuleExportsAccessExpression(left) && !isExportsIdentifier(get(bin, "Right"))) return true;
  const le = get(left, "Expression");
  if ((isModuleExportsAccessExpression(le) || isExportsIdentifier(le)) && getElementOrPropertyAccessName(left)) return true;
  if (le.kind === "ThisKeyword") return true;
  if ((left.kind === "PropertyAccessExpression" && isEntityNameExpressionEx(le, true) && isIdentifier(get(left, "name"))) || (left.kind === "ElementAccessExpression" && isEntityNameExpressionEx(le, true))) return true;
  return false;
}
function hasSamePropertyAccessName(a, b) {
  if (a.kind === "Identifier" && b.kind === "Identifier") return textOf(a) === textOf(b);
  if (a.kind === "PropertyAccessExpression" && b.kind === "PropertyAccessExpression") return textOf(get(a, "name")) === textOf(get(b, "name")) && hasSamePropertyAccessName(get(a, "Expression"), get(b, "Expression"));
  return false;
}
// Node.Type(): the field that holds the type annotation of the kinds the reparser asks.
const typeOf = n => get(n, "Type");
const typeExpressionType = tag => { const te = get(tag, "TypeExpression"); return te ? get(te, "Type") : undefined; };

class Reparser {
  constructor(file) {
    this.file = file;
    this.contextFlags = 0;
    this.inObjectLiteralMembers = false;
    this.reparseList = [];
    this.reparsedClones = 0;
    this.diagnostics = [];
  }
  finishReparsedNode(node, locationNode) {
    node.flags = (this.contextFlags | GOF.Reparsed) >>> 0;
    node.pos = locationNode.pos; node.end = locationNode.end;
    overrideParentInImmediateChildren(node);
  }
  finishMutatedNode(node) { overrideParentInImmediateChildren(node); }
  addDeepCloneReparse(node) {
    const clone = deepCloneReparse(node);
    if (clone) this.reparsedClones++;
    return clone;
  }
  addTransformedReparse(newNode, old) {
    this.finishReparsedNode(newNode, old);
    newNode.flags = (newNode.flags | GOF.ReparserTransformedLiteral) >>> 0;
    this.reparsedClones++;
    return newNode;
  }
  checkNonIdentifierName(name) {
    if (isIdentifier(name) && !isValidIdentifier(textOf(name))) {
      let pos = name.pos, end = name.end;
      if (end - pos === 0) { pos = name.pos - 1; end = name.pos; }
      this.diagnostics.push({ pos, end, code: 1003 });
      hit("diagnostic:checkNonIdentifierName");
    }
    return name;
  }
  newIdentifier(text) { const n = mk("Identifier"); n.scalars.set("Text", { s: text }); return n; }
  newToken(kind, loc) { const n = mk(kind); n.pos = loc.pos; n.end = loc.end; n.flags = (this.contextFlags | GOF.Reparsed) >>> 0; return n; }

  reparseTags(parent, jsDoc) {
    for (const j of jsDoc) {
      const isLast = j === jsDoc[jsDoc.length - 1];
      const tags = get(j, "Tags");
      if (!tags) continue;
      for (const tag of tags.nodes) {
        this.reparseUnhosted(tag, parent, j);
        if (isLast) this.reparseHosted(tag, parent, j);
      }
    }
  }

  reparseUnhosted(tag, parent, jsDoc) {
    switch (tag.kind) {
      case "JSDocTypedefTag": {
        const typeExpression = get(tag, "TypeExpression");
        if (!typeExpression) break;
        hit("unhosted:typedef");
        const fullName = get(tag, "name");
        const isNamespace = !!fullName && fullName.kind === "ModuleDeclaration";
        const modifiers = isNamespace ? this.createExportModifier(tag) : undefined;
        const typeAlias = mk("JSTypeAliasDeclaration");
        setChild(typeAlias, "modifiers", modifiers);
        setChild(typeAlias, "name", this.addDeepCloneReparse(this.checkNonIdentifierName(this.getInnermostNameOfJSDocNamespace(fullName))));
        setChild(typeAlias, "TypeParameters", this.gatherTypeParameters(jsDoc, true));
        let t;
        if (typeExpression.kind === "JSDocTypeExpression") t = this.addDeepCloneReparse(get(typeExpression, "Type"));
        else if (typeExpression.kind === "JSDocTypeLiteral") t = this.reparseJSDocTypeLiteral(typeExpression);
        else throw new Error("typedef tag type expression should be a name reference or a type expression " + typeExpression.kind);
        setChild(typeAlias, "Type", t);
        this.finishReparsedNode(typeAlias, tag);
        typeAlias.jsdoc = [jsDoc];
        typeAlias.flags = (typeAlias.flags | GOF.HasJSDoc) >>> 0;
        this.reparseList.push(this.wrapInJSDocNamespace(fullName, typeAlias, false));
        break;
      }
      case "JSDocCallbackTag": {
        const typeExpression = get(tag, "TypeExpression");
        if (!typeExpression) break;
        hit("unhosted:callback");
        const fullName = get(tag, "name");
        const isNamespace = !!fullName && fullName.kind === "ModuleDeclaration";
        const modifiers = isNamespace ? this.createExportModifier(tag) : undefined;
        const functionType = this.reparseJSDocSignature(typeExpression, tag, jsDoc, tag, undefined);
        const typeAlias = mk("JSTypeAliasDeclaration");
        setChild(typeAlias, "modifiers", modifiers);
        setChild(typeAlias, "name", this.addDeepCloneReparse(this.getInnermostNameOfJSDocNamespace(fullName)));
        setChild(typeAlias, "Type", functionType);
        setChild(typeAlias, "TypeParameters", this.gatherTypeParameters(jsDoc, true));
        this.finishReparsedNode(typeAlias, tag);
        typeAlias.jsdoc = [jsDoc];
        typeAlias.flags = (typeAlias.flags | GOF.HasJSDoc) >>> 0;
        this.reparseList.push(this.wrapInJSDocNamespace(fullName, typeAlias, false));
        break;
      }
      case "JSDocImportTag": {
        if (!get(tag, "ImportClause")) break;
        hit("unhosted:import");
        const importClause = this.addDeepCloneReparse(get(tag, "ImportClause"));
        importClause.scalars.set("PhaseModifier", { k: "TypeKeyword" });
        const importDeclaration = mk("JSImportDeclaration");
        setChild(importDeclaration, "modifiers", deepCloneReparseModifiers(get(tag, "modifiers")));
        setChild(importDeclaration, "ImportClause", importClause);
        setChild(importDeclaration, "ModuleSpecifier", this.addDeepCloneReparse(get(tag, "ModuleSpecifier")));
        setChild(importDeclaration, "Attributes", this.addDeepCloneReparse(get(tag, "Attributes")));
        this.finishReparsedNode(importDeclaration, tag);
        this.reparseList.push(importDeclaration);
        break;
      }
      case "JSDocOverloadTag":
        if ((parent.kind === "FunctionDeclaration" || parent.kind === "MethodDeclaration" || parent.kind === "Constructor") && !this.inObjectLiteralMembers) {
          hit("unhosted:overload");
          this.reparseList.push(this.reparseJSDocSignature(get(tag, "TypeExpression"), parent, jsDoc, tag, get(parent, "modifiers")));
        }
        break;
    }
  }

  reparseJSDocSignature(jsSignature, fun, jsDoc, tag, modifiers) {
    let signature;
    const clonedModifiers = deepCloneReparseModifiers(modifiers);
    switch (fun.kind) {
      case "FunctionDeclaration":
        signature = mk("FunctionDeclaration"); setChild(signature, "modifiers", clonedModifiers); setChild(signature, "name", deepCloneReparse(this.checkNonIdentifierName(get(fun, "name")))); break;
      case "MethodDeclaration":
        signature = mk("MethodDeclaration"); setChild(signature, "modifiers", clonedModifiers); setChild(signature, "name", deepCloneReparse(this.checkNonIdentifierName(get(fun, "name")))); break;
      case "Constructor":
        signature = mk("Constructor"); setChild(signature, "modifiers", clonedModifiers); break;
      case "JSDocCallbackTag":
        signature = mk("FunctionType"); setChild(signature, "Type", mk("AnyKeyword")); break;
      default: throw new Error("Unexpected kind " + fun.kind);
    }
    if (tag.kind !== "JSDocCallbackTag") setChild(signature, "TypeParameters", this.gatherTypeParameters(jsDoc, false));
    const parameters = [];
    const jsParams = get(jsSignature, "Parameters");
    let pi = -1;
    for (const param of jsParams?.nodes ?? []) {
      pi++;
      let parameter;
      if (param.kind === "JSDocThisTag") {
        const thisIdent = this.newIdentifier("this");
        thisIdent.pos = param.pos; thisIdent.end = param.end;
        thisIdent.flags = (this.contextFlags | GOF.Reparsed) >>> 0;
        parameter = mk("Parameter");
        setChild(parameter, "name", thisIdent);
        const te = get(param, "TypeExpression");
        if (te) setChild(parameter, "Type", this.addDeepCloneReparse(get(te, "Type")));
      } else if (param.kind === "JSDocParameterTag" || param.kind === "JSDocPropertyTag") {
        if (get(param, "name").kind === "QualifiedName") continue;
        let dotDotDotToken, paramType;
        const te = get(param, "TypeExpression");
        if (te) {
          const tt = get(te, "Type");
          if (tt.kind === "JSDocVariadicType") {
            dotDotDotToken = this.newToken("DotDotDotToken", param);
            paramType = this.reparseJSDocTypeLiteral(get(tt, "Type"));
          } else paramType = this.reparseJSDocTypeLiteral(tt);
        }
        let name = get(param, "name");
        if (isIdentifier(name) && !isValidIdentifier(textOf(name))) {
          let result = "";
          let i = 0;
          for (const ch of textOf(name)) {
            if (i === 0) result += isIdentifierStart(ch) ? ch : "_";
            else result += isIdentifierPart(ch) ? ch : "_";
            i++;
          }
          if (result.length === 0) result = "_" + pi;
          name = this.addTransformedReparse(this.newIdentifier(result), name);
          hit("transformed-parameter-name");
        } else name = this.addDeepCloneReparse(name);
        parameter = mk("Parameter");
        setChild(parameter, "DotDotDotToken", dotDotDotToken);
        setChild(parameter, "name", name);
        setChild(parameter, "QuestionToken", this.makeQuestionIfOptional(param));
        setChild(parameter, "Type", paramType);
      }
      this.finishReparsedNode(parameter, param);
      parameters.push(parameter);
      this.reparseJSDocComment(parameter, param);
    }
    signature.children.set("Parameters", newList(jsParams ? jsParams.pos : -1, jsParams ? jsParams.end : -1, parameters));
    const ret = get(jsSignature, "Type");
    if (ret && get(ret, "TypeExpression")) setChild(signature, "Type", this.addDeepCloneReparse(get(get(ret, "TypeExpression"), "Type")));
    let loc = jsSignature;
    if (tag.kind === "JSDocOverloadTag") loc = get(tag, "TagName");
    this.finishReparsedNode(signature, loc);
    return signature;
  }

  reparseJSDocTypeLiteral(t) {
    if (!t) return undefined;
    if (t.kind === "JSDocTypeLiteral") {
      const isArrayType = !!t.scalars.get("IsArrayType")?.b;
      const properties = [];
      for (const prop of nodesOf(t, "JSDocPropertyTags")) {
        if (prop.kind !== "JSDocPropertyTag" && prop.kind !== "JSDocParameterTag") continue;
        let name = get(prop, "name");
        if (name.kind === "QualifiedName") name = get(name, "Right");
        if (isIdentifier(name) && !isValidIdentifier(textOf(name))) {
          const lit = mk("StringLiteral");
          lit.scalars.set("Text", { s: textOf(name) });
          lit.scalars.set("TokenFlags", { x: 0 });
          name = this.addTransformedReparse(lit, name);
          hit("transformed-property-name");
        } else name = this.addDeepCloneReparse(name);
        const property = mk("PropertySignature");
        setChild(property, "name", name);
        setChild(property, "PostfixToken", this.makeQuestionIfOptional(prop));
        const te = get(prop, "TypeExpression");
        if (te) setChild(property, "Type", this.reparseJSDocTypeLiteral(get(te, "Type")));
        this.finishReparsedNode(property, prop);
        properties.push(property);
        this.reparseJSDocComment(property, prop);
      }
      let lit = mk("TypeLiteral");
      lit.children.set("Members", newList(t.pos, t.end, properties));
      if (isArrayType) {
        this.finishReparsedNode(lit, t);
        const arr = mk("ArrayType");
        setChild(arr, "ElementType", lit);
        lit = arr;
      }
      this.finishReparsedNode(lit, t);
      return lit;
    }
    return this.addDeepCloneReparse(t);
  }

  reparseJSDocComment(node, tag) {
    const comment = get(tag, "Comment");
    if (comment) {
      const propJSDoc = mk("JSDoc");
      propJSDoc.children.set("Comment", { ...comment, nodes: comment.nodes.map(deepCloneReparse) });
      this.finishReparsedNode(propJSDoc, tag);
      propJSDoc.parent = node;
      node.jsdoc = [propJSDoc];
      node.flags = (node.flags | GOF.HasJSDoc) >>> 0;
    }
  }

  gatherTypeParameters(j, typedefOrCallback) {
    const typeParameters = [];
    let pos = -1, endPos = -1, firstTemplate = true;
    for (const tag of nodesOf(j, "Tags")) {
      if (!typedefOrCallback && (tag.kind === "JSDocTypedefTag" || tag.kind === "JSDocCallbackTag")) return undefined;
      if (tag.kind !== "JSDocTemplateTag") continue;
      if (firstTemplate) { pos = tag.pos; firstTemplate = false; }
      endPos = tag.end;
      const constraint = get(tag, "Constraint");
      let firstTypeParameter = true;
      for (const tp of nodesOf(tag, "TypeParameters")) {
        let reparse;
        if (constraint && firstTypeParameter) {
          reparse = mk("TypeParameter");
          setChild(reparse, "modifiers", deepCloneReparseModifiers(get(tp, "modifiers")));
          setChild(reparse, "name", this.addDeepCloneReparse(this.checkNonIdentifierName(get(tp, "name"))));
          setChild(reparse, "Constraint", this.addDeepCloneReparse(get(constraint, "Type")));
          setChild(reparse, "DefaultType", this.addDeepCloneReparse(get(tp, "DefaultType")));
          this.finishReparsedNode(reparse, tp);
        } else reparse = this.addDeepCloneReparse(tp);
        typeParameters.push(reparse);
        firstTypeParameter = false;
      }
    }
    if (typeParameters.length === 0) return undefined;
    return newList(pos, endPos, typeParameters);
  }

  reparseHosted(tag, parent, jsDoc) {
    switch (tag.kind) {
      case "JSDocTypeTag": {
        const tt = typeExpressionType(tag);
        const hasTE = !!get(tag, "TypeExpression");
        switch (parent.kind) {
          case "VariableStatement": {
            const dl = get(parent, "DeclarationList");
            if (dl) for (const declaration of nodesOf(dl, "Declarations")) {
              if (!typeOf(declaration) && hasTE) {
                setChild(declaration, "Type", this.addDeepCloneReparse(tt));
                this.finishMutatedNode(declaration);
                hit("hosted:type:variable-statement");
                return;
              }
            }
            break;
          }
          case "VariableDeclaration": case "ExportAssignment": case "PropertyDeclaration": case "PropertyAssignment": case "ShorthandPropertyAssignment": case "GetAccessor":
            if (!typeOf(parent) && hasTE) {
              setChild(parent, "Type", this.addDeepCloneReparse(tt));
              this.finishMutatedNode(parent);
              hit("hosted:type:" + parent.kind);
              return;
            }
            break;
          case "Parameter":
            if (!typeOf(parent) && hasTE) {
              setChild(parent, "Type", this.reparseJSDocTypeLiteral(tt));
              this.finishMutatedNode(parent);
              hit("hosted:type:Parameter");
              return;
            }
            break;
          case "ExpressionStatement": {
            const e = get(parent, "Expression");
            if (e.kind === "BinaryExpression" && isAssignmentDeclaration(e) && hasTE) {
              setChild(e, "Type", this.addDeepCloneReparse(tt));
              this.finishMutatedNode(e);
              hit("hosted:type:assignment");
              return;
            }
            break;
          }
          case "ReturnStatement": case "ParenthesizedExpression":
            if (get(parent, "Expression") && hasTE) {
              setChild(parent, "Expression", this.makeNewCast(this.addDeepCloneReparse(tt), get(parent, "Expression"), true));
              this.finishMutatedNode(parent);
              hit("hosted:type:cast");
              return;
            }
            break;
        }
        const fun = getFunctionLikeHost(parent);
        if (fun) {
          const noTypedParams = nodesOf(fun, "Parameters").every(p => !typeOf(p));
          if (!get(fun, "TypeParameters") && !typeOf(fun) && noTypedParams && hasTE) {
            setChild(fun, "FullSignature", this.addDeepCloneReparse(tt));
            this.finishMutatedNode(fun);
            hit("hosted:type:full-signature");
          }
        }
        break;
      }
      case "JSDocSatisfiesTag": {
        const tt = typeExpressionType(tag);
        const hasTE = !!get(tag, "TypeExpression");
        switch (parent.kind) {
          case "VariableStatement": {
            const dl = get(parent, "DeclarationList");
            if (dl) for (const declaration of nodesOf(dl, "Declarations")) {
              if (get(declaration, "Initializer") && hasTE) {
                setChild(declaration, "Initializer", this.makeNewCast(this.addDeepCloneReparse(tt), get(declaration, "Initializer"), false));
                this.finishMutatedNode(declaration);
                hit("hosted:satisfies");
                break;
              }
            }
            break;
          }
          case "VariableDeclaration": case "PropertyDeclaration": case "PropertyAssignment":
            if (get(parent, "Initializer") && hasTE) {
              setChild(parent, "Initializer", this.makeNewCast(this.addDeepCloneReparse(tt), get(parent, "Initializer"), false));
              this.finishMutatedNode(parent);
              hit("hosted:satisfies");
            }
            break;
          case "ShorthandPropertyAssignment":
            if (get(parent, "ObjectAssignmentInitializer") && hasTE) {
              setChild(parent, "ObjectAssignmentInitializer", this.makeNewCast(this.addDeepCloneReparse(tt), get(parent, "ObjectAssignmentInitializer"), false));
              this.finishMutatedNode(parent);
              hit("hosted:satisfies");
            }
            break;
          case "ReturnStatement": case "ParenthesizedExpression": case "ExportAssignment":
            if (get(parent, "Expression") && hasTE) {
              setChild(parent, "Expression", this.makeNewCast(this.addDeepCloneReparse(tt), get(parent, "Expression"), false));
              this.finishMutatedNode(parent);
              hit("hosted:satisfies");
            }
            break;
          case "ExpressionStatement": {
            const bin = get(parent, "Expression");
            if (bin.kind === "BinaryExpression" && isAssignmentDeclaration(bin) && hasTE) {
              setChild(bin, "Right", this.makeNewCast(this.addDeepCloneReparse(tt), get(bin, "Right"), false));
              this.finishMutatedNode(bin);
              hit("hosted:satisfies");
            }
            break;
          }
        }
        break;
      }
      case "JSDocTemplateTag": {
        const fun = getFunctionLikeHost(parent);
        if (fun) {
          if (!get(fun, "TypeParameters") && !get(fun, "FullSignature")) {
            setChild(fun, "TypeParameters", this.gatherTypeParameters(jsDoc, false));
            this.finishMutatedNode(fun);
            hit("hosted:template:function");
          }
        } else if (parent.kind === "ClassDeclaration" || parent.kind === "ClassExpression") {
          if (!get(parent, "TypeParameters")) {
            setChild(parent, "TypeParameters", this.gatherTypeParameters(jsDoc, false));
            this.finishMutatedNode(parent);
            hit("hosted:template:class");
          }
        }
        break;
      }
      case "JSDocParameterTag": {
        const fun = getFunctionLikeHost(parent);
        if (fun && !get(fun, "FullSignature")) {
          const param = findMatchingParameter(fun, tag, jsDoc);
          if (param) {
            const te = get(tag, "TypeExpression");
            if (!typeOf(param) && te) setChild(param, "Type", this.reparseJSDocTypeLiteral(get(te, "Type")));
            if (!get(param, "QuestionToken")) {
              const question = this.makeQuestionIfOptional(tag);
              if (question) setChild(param, "QuestionToken", question);
            }
            this.finishMutatedNode(param);
            hit("hosted:param");
          }
        }
        break;
      }
      case "JSDocThisTag": {
        const fun = getFunctionLikeHost(parent);
        if (fun) {
          const params = nodesOf(fun, "Parameters");
          const first = params[0] ? get(params[0], "name") : undefined;
          if (params.length === 0 || (first.kind !== "ThisKeyword" && !(isIdentifier(first) && textOf(first) === "this"))) {
            const thisParam = mk("Parameter");
            setChild(thisParam, "name", this.newIdentifier("this"));
            const te = get(tag, "TypeExpression");
            if (te) setChild(thisParam, "Type", this.addDeepCloneReparse(get(te, "Type")));
            this.finishReparsedNode(thisParam, get(tag, "TagName"));
            const old = get(fun, "Parameters");
            fun.children.set("Parameters", newList(old.pos, old.end, [thisParam, ...params]));
            this.finishMutatedNode(fun);
            hit("hosted:this");
          }
        }
        break;
      }
      case "JSDocReturnTag": {
        const fun = getFunctionLikeHost(parent);
        if (fun && !get(fun, "FullSignature")) {
          if (!typeOf(fun) && get(tag, "TypeExpression")) {
            setChild(fun, "Type", this.addDeepCloneReparse(typeExpressionType(tag)));
            this.finishMutatedNode(fun);
            hit("hosted:return");
          }
        }
        break;
      }
      case "JSDocReadonlyTag": case "JSDocPrivateTag": case "JSDocPublicTag": case "JSDocProtectedTag": case "JSDocOverrideTag": {
        if (parent.kind === "ExpressionStatement") parent = get(parent, "Expression");
        switch (parent.kind) {
          case "MethodDeclaration": case "GetAccessor": case "SetAccessor":
            if (this.inObjectLiteralMembers) return;
          // falls through
          case "PropertyDeclaration": case "Constructor": case "BinaryExpression": {
            const keyword = { JSDocReadonlyTag: "ReadonlyKeyword", JSDocPrivateTag: "PrivateKeyword", JSDocPublicTag: "PublicKeyword", JSDocProtectedTag: "ProtectedKeyword", JSDocOverrideTag: "OverrideKeyword" }[tag.kind];
            const modifier = this.newToken(keyword, tag);
            const old = get(parent, "modifiers");
            let list;
            if (!old) list = newModifierList(tag.pos, tag.end, [modifier]);
            else list = newModifierList(old.pos, old.end, [...old.nodes, modifier]);
            parent.children.set("modifiers", list);
            this.finishMutatedNode(parent);
            hit("hosted:modifier");
          }
        }
        break;
      }
      case "JSDocImplementsTag": {
        if (parent.kind === "ClassDeclaration" || parent.kind === "ClassExpression") {
          const className = get(tag, "ClassName");
          const clauses = get(parent, "HeritageClauses");
          if (clauses) {
            const implementsClause = clauses.nodes.find(n => n.scalars.get("Token")?.k === "ImplementsKeyword");
            if (implementsClause) {
              get(implementsClause, "Types").nodes.push(this.addDeepCloneReparse(className));
              this.finishMutatedNode(implementsClause);
              hit("hosted:implements:append");
              return;
            }
          }
          const typesList = newList(className.pos, className.end, [this.addDeepCloneReparse(className)]);
          const heritageClause = mk("HeritageClause");
          heritageClause.scalars.set("Token", { k: "ImplementsKeyword" });
          heritageClause.children.set("Types", typesList);
          this.finishReparsedNode(heritageClause, className);
          if (!clauses) parent.children.set("HeritageClauses", newList(className.pos, className.end, [heritageClause]));
          else clauses.nodes.push(heritageClause);
          this.finishMutatedNode(parent);
          hit("hosted:implements:new");
        }
        break;
      }
      case "JSDocAugmentsTag": {
        if ((parent.kind === "ClassDeclaration" || parent.kind === "ClassExpression") && get(parent, "HeritageClauses")) {
          const extendsClause = get(parent, "HeritageClauses").nodes.find(n => n.scalars.get("Token")?.k === "ExtendsKeyword");
          if (extendsClause && nodesOf(extendsClause, "Types").length === 1) {
            const target = nodesOf(extendsClause, "Types")[0];
            const source = get(tag, "ClassName");
            if (hasSamePropertyAccessName(get(target, "Expression"), get(source, "Expression"))) {
              const sa = get(source, "TypeArguments");
              if (!get(target, "TypeArguments") && sa) {
                target.children.set("TypeArguments", newList(sa.pos, sa.end, sa.nodes.map(a => this.addDeepCloneReparse(a))));
                this.finishMutatedNode(target);
                hit("hosted:augments");
              }
            }
          }
        }
        break;
      }
    }
  }

  makeQuestionIfOptional(parameter) {
    const te = get(parameter, "TypeExpression");
    if (parameter.scalars.get("IsBracketed")?.b || (te && get(te, "Type").kind === "JSDocOptionalType")) return this.newToken("QuestionToken", parameter);
    return undefined;
  }

  makeNewCast(t, e, isAssertion) {
    const assert = mk(isAssertion ? "AsExpression" : "SatisfiesExpression");
    setChild(assert, "Expression", e);
    setChild(assert, "Type", t);
    assert.pos = e.pos; assert.end = e.end;
    assert.flags = (assert.flags | this.contextFlags) >>> 0;
    overrideParentInImmediateChildren(assert);
    return assert;
  }

  createExportModifier(locationNode) {
    return newModifierList(locationNode.pos, locationNode.end, [this.newToken("ExportKeyword", locationNode)]);
  }

  getInnermostNameOfJSDocNamespace(fullName) {
    if (!fullName) return undefined;
    while (fullName.kind === "ModuleDeclaration") {
      const body = get(fullName, "Body");
      if (!body) return get(fullName, "name");
      fullName = body;
    }
    return fullName;
  }

  wrapInJSDocNamespace(fullName, statement, nested) {
    if (!fullName || fullName.kind !== "ModuleDeclaration") return statement;
    const wrapped = this.wrapInJSDocNamespace(get(fullName, "Body"), statement, true);
    const block = mk("ModuleBlock");
    block.children.set("Statements", newList(fullName.pos, fullName.end, [wrapped]));
    this.finishReparsedNode(block, fullName);
    const modifiers = nested ? this.createExportModifier(fullName) : undefined;
    const result = mk("ModuleDeclaration");
    setChild(result, "modifiers", modifiers);
    result.scalars.set("Keyword", { k: "NamespaceKeyword" });
    setChild(result, "name", this.addDeepCloneReparse(get(fullName, "name")));
    setChild(result, "Body", block);
    this.finishReparsedNode(result, fullName);
    this.reparsedClones++;
    hit("namespace-wrap");
    return result;
  }
}

function findMatchingParameter(fun, parameterTag, jsDoc) {
  let tagIndex = -1, paramCount = -1;
  for (const tag of nodesOf(jsDoc, "Tags")) {
    if (tag.kind === "JSDocParameterTag") {
      paramCount++;
      if (tag === parameterTag) { tagIndex = paramCount; break; }
    }
  }
  const params = nodesOf(fun, "Parameters");
  const tagName = get(parameterTag, "name");
  for (let parameterIndex = 0; parameterIndex < params.length; parameterIndex++) {
    const parameter = params[parameterIndex];
    const name = get(parameter, "name");
    if (name.kind === "Identifier") {
      if (tagName.kind === "Identifier" && (textOf(name) === textOf(tagName) || (parameterIndex === tagIndex && textOf(tagName).length === 0))) return parameter;
    } else if (parameterIndex === tagIndex) return parameter;
  }
  return undefined;
}

function skipSatisfiesExpressions(n) { while (n && n.kind === "SatisfiesExpression") n = get(n, "Expression"); return n; }

function getFunctionLikeHost(host) {
  let fun = host;
  switch (host.kind) {
    case "VariableStatement": { const nodes = nodesOf(get(host, "DeclarationList"), "Declarations"); if (nodes.length !== 0) fun = get(nodes[0], "Initializer"); break; }
    case "PropertyAssignment": case "PropertyDeclaration": fun = get(host, "Initializer"); break;
    case "ExportAssignment": case "ReturnStatement": fun = get(host, "Expression"); break;
    case "ExpressionStatement": fun = getRightMostAssignedExpression(get(host, "Expression")); break;
  }
  fun = skipSatisfiesExpressions(fun);
  return isFunctionLike(fun) ? fun : undefined;
}

// The lists that parseListIndex builds: the reparse list is emptied into them. Value: true when the list takes every entry.
const FLUSH_LISTS = new Map([
  ["SourceFile.Statements", true], ["Block.Statements", true], ["ModuleBlock.Statements", true],
  ["CaseClause.Statements", false], ["DefaultClause.Statements", false], ["CaseBlock.Clauses", false],
  ["ClassDeclaration.Members", false], ["ClassExpression.Members", false],
  ["ClassDeclaration.HeritageClauses", false], ["ClassExpression.HeritageClauses", false], ["InterfaceDeclaration.HeritageClauses", false],
  ["TypeLiteral.Members", false], ["InterfaceDeclaration.Members", false], ["MappedType.Members", false], ["JsxAttributes.Properties", false],
]);

function fieldOf(parent, child) {
  for (const [name, v] of parent.children) {
    if (v.list) { const i = v.nodes.indexOf(child); if (i >= 0) return { name, list: v, index: i }; }
    else if (v === child) return { name };
  }
  return undefined;
}

function placeReparsed(root, host, entry) {
  const onlyStatements = entry.kind === "JSTypeAliasDeclaration" || entry.kind === "JSImportDeclaration";
  let child = host;
  for (let parent = host.parent; parent; child = parent, parent = parent.parent) {
    const f = fieldOf(parent, child);
    if (!f) { hit("place:lost-parent-link"); break; }
    if (!f.list) continue;
    const takesAll = FLUSH_LISTS.get(parent.kind + "." + f.name);
    if (takesAll === undefined) continue;
    if (onlyStatements && !takesAll) { hit("place:propagated-outwards"); continue; }
    f.list.nodes.splice(f.index, 0, entry);
    entry.parent = parent;
    return;
  }
  // The host is the end of file token, or no list was found: the entry goes to the end of the statements.
  root.children.get("Statements").nodes.push(entry);
  entry.parent = root;
  hit("place:end-of-file");
}

function sortedChildren(n) {
  const out = [];
  forEachChild(n, c => out.push(c));
  return out.sort((a, b) => a.pos - b.pos || a.end - b.end);
}

// The hosts in the order in which the parser finishes them.
function collectHosts(root) {
  const hosts = [];
  (function walk(n, inObjectLiteral) {
    for (const c of sortedChildren(n)) {
      const f = n.kind === "ObjectLiteralExpression" && n.children.get("Properties")?.nodes.includes(c);
      walk(c, inObjectLiteral || f);
    }
    if (n.jsdoc.length) hosts.push({ node: n, inObjectLiteral });
  })(root, false);
  return hosts;
}

export function setParents(root) {
  (function walk(n) {
    forEachChild(n, c => { c.parent = n; walk(c); });
    for (const j of n.jsdoc) { j.parent = n; walk(j); }
  })(root);
  root.parent = null;
}

// Every node in the order in which the parser finishes it.
function finishOrder(root) {
  const order = [];
  (function walk(n) { for (const c of sortedChildren(n)) walk(c); order.push(n); })(root);
  return order;
}

export function reparse(root) {
  setParents(root);
  const r = new Reparser(root);
  const eof = root.children.get("EndOfFileToken");
  const order = finishOrder(root);
  const indexOf = new Map(order.map((n, i) => [n, i]));
  // Rule top-level-await: a statement that the parser reads a second time, in the await context, keeps the unhosted
  // declarations of the first reading and loses the JSDoc attachments and the clone records of the second reading.
  const isModule = !!externalModuleIndicator(root, {});
  const AWAIT_BY_ITSELF = new Set(["ExportAssignment", "ExportDeclaration", "ImportEqualsDeclaration", "ImportDeclaration", "FunctionDeclaration", "ClassDeclaration"]);
  const rereadStatements = new Set(isModule ? root.children.get("Statements").nodes.filter(s => (s.flags & GOF.AwaitContext) && !AWAIT_BY_ITSELF.has(s.kind)) : []);
  const topStatementOf = n => { while (n.parent && n.parent !== root) n = n.parent; return n; };
  for (const { node, inObjectLiteral } of collectHosts(root)) {
    const reread = rereadStatements.has(topStatementOf(node));
    r.inObjectLiteralMembers = inObjectLiteral;
    const errorsBefore = r.diagnostics.length;
    if (reread) {
      hit("top-level-await:reread-host");
      // First reading: only the unhosted declarations survive, made from a copy of the comment without the await flag.
      const clearAwait = g => { g.flags = (g.flags & ~GOF.AwaitContext) >>> 0; for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) clearAwait(x); else clearAwait(c); } };
      const firstJsdoc = node.jsdoc.map(j => { const c = cloneTree(j); c.parent = node; setParentInChildren(c); clearAwait(c); return c; });
      r.contextFlags = (node.flags & CONTEXT_MASK & ~GOF.AwaitContext) >>> 0;
      r.reparseList = [];
      const clonesBefore = r.reparsedClones;
      for (const j of firstJsdoc) { const tags = j.children.get("Tags"); if (tags) for (const tag of tags.nodes) r.reparseUnhosted(tag, node, j); }
      const kept = r.reparseList;
      // Second reading: the hosted changes stay, its unhosted declarations and its records are dropped.
      r.contextFlags = (node.flags & CONTEXT_MASK) >>> 0;
      r.reparseList = [];
      const secondClones = r.reparsedClones;
      const last = node.jsdoc[node.jsdoc.length - 1];
      const tags = last?.children.get("Tags");
      if (tags) for (const tag of tags.nodes) r.reparseHosted(tag, node, last);
      r.reparsedClones = secondClones;
      node.jsdoc = [];
      r.reparseList = kept;
      void clonesBefore;
    } else {
      r.contextFlags = (node.flags & CONTEXT_MASK) >>> 0;
      r.reparseList = [];
      r.reparseTags(node, node.jsdoc);
    }
    // A parse error of the reparser is pending: the node that the parser finishes next carries the flag.
    if (r.diagnostics.length !== errorsBefore) {
      const next = order[indexOf.get(node) + 1];
      if (next) { next.flags = (next.flags | GOF.ThisNodeHasError) >>> 0; hit("pending-parse-error-flag"); }
    }
    for (const entry of r.reparseList) {
      if (node === eof) { root.children.get("Statements").nodes.push(entry); entry.parent = root; hit("place:end-of-file"); }
      else placeReparsed(root, node, entry);
    }
  }
  root.reparsedClones = r.reparsedClones;
  root.reparseDiagnostics = r.diagnostics;
  return root;
}

// ---------- printing in the canonical form of the Go probe, with parent notes and shared nodes ----------
import { quoteToASCII } from "./convert.mjs";
const hex = x => (x === 0 ? "0x0" : "0x" + (x >>> 0).toString(16));
export function print(root) {
  const lines = [];
  const seen = new Set();
  function list(label, l, parent, indent) {
    lines.push(`${" ".repeat(indent)}.${label}: list [${l.pos},${l.end}) n=${l.nodes.length}`);
    for (const c of l.nodes) node("-", c, parent, indent + 2);
  }
  function node(label, n, parent, indent) {
    const pad = " ".repeat(indent);
    let line = `${pad}${label} Kind${n.kind} [${n.pos},${n.end}) f=${hex(n.flags)}`;
    if (n.parent !== undefined && n.parent !== parent) line += n.parent === null ? " parent=nil" : ` parent=Kind${n.parent.kind}[${n.parent.pos},${n.parent.end})`;
    if (seen.has(n)) { lines.push(line + " SHARED"); return; }
    seen.add(n);
    const names = [...new Set([...n.scalars.keys(), ...n.children.keys()])].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    for (const name of names) {
      const v = n.scalars.get(name);
      if (!v) continue;
      if ("k" in v) line += ` ${name}=Kind${v.k}`;
      else if ("x" in v) line += ` ${name}=${hex(v.x)}`;
      else if ("s" in v) line += ` ${name}=${quoteToASCII(v.s)}`;
      else if ("b" in v) { if (v.b) line += ` ${name}`; }
    }
    lines.push(line);
    if (n.kind === "SourceFile") {
      list("Statements", n.children.get("Statements"), n, indent + 2);
      node(".EndOfFileToken:", n.children.get("EndOfFileToken"), n, indent + 2);
    } else {
      for (const name of names) {
        const c = n.children.get(name);
        if (!c) continue;
        if (c.list) {
          if (c.modifiers) lines.push(`${pad}  .${name}.flags=${hex(c.modifierFlags)}`);
          list(c.raw ? name + "(raw)" : name, c, n, indent + 2);
        } else node("." + name + ":", c, n, indent + 2);
      }
    }
    for (const j of n.jsdoc) node(".jsdoc:", j, n, indent + 2);
  }
  node("root", root, null, 0);
  return lines;
}
