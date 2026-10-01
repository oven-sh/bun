// Probe: a port of typescript-go's internal/parser/reparser.go as a pass over a finished tree (route A).
// The tree is the "g" shape of convert.mjs: {kind,pos,end,flags,scalars,children,jsdoc,parent}.
import ts from "typescript";
import { GOF, mk, modifiersToFlags } from "./convert.mjs";
import { byKind } from "./gotable.mjs";

export const contextFlagsMask = () => GOF.DisallowInContext | GOF.DisallowConditionalTypesContext | GOF.YieldContext | GOF.DecoratorContext | GOF.AwaitContext | GOF.JavaScriptFile | GOF.InWithStatement | GOF.Ambient;
// The lists that parseList or parseListIndex builds, with their parsing context.
const PARSE_LISTS = {
  SourceFile: { Statements: "SourceElements" },
  Block: { Statements: "BlockStatements" },
  ModuleBlock: { Statements: "BlockStatements" },
  CaseBlock: { Clauses: "SwitchClauses" },
  CaseClause: { Statements: "SwitchClauseStatements" },
  DefaultClause: { Statements: "SwitchClauseStatements" },
  ClassDeclaration: { Members: "ClassMembers", HeritageClauses: "HeritageClauses" },
  ClassExpression: { Members: "ClassMembers", HeritageClauses: "HeritageClauses" },
  InterfaceDeclaration: { Members: "TypeMembers", HeritageClauses: "HeritageClauses" },
  TypeLiteral: { Members: "TypeMembers" },
  MappedType: { Members: "TypeMembers" },
  JsxAttributes: { Properties: "JsxAttributes" },
};
const FUNCTION_LIKE = new Set(["MethodSignature", "CallSignature", "JSDocSignature", "ConstructSignature", "IndexSignature", "FunctionType", "ConstructorType",
  "FunctionDeclaration", "MethodDeclaration", "Constructor", "GetAccessor", "SetAccessor", "FunctionExpression", "ArrowFunction"]);
const LHS = new Set(["PropertyAccessExpression", "ElementAccessExpression", "NewExpression", "CallExpression", "JsxElement", "JsxSelfClosingElement", "JsxFragment",
  "TaggedTemplateExpression", "ArrayLiteralExpression", "ParenthesizedExpression", "ObjectLiteralExpression", "ClassExpression", "FunctionExpression", "Identifier",
  "PrivateIdentifier", "RegularExpressionLiteral", "NumericLiteral", "BigIntLiteral", "StringLiteral", "NoSubstitutionTemplateLiteral", "TemplateExpression",
  "FalseKeyword", "NullKeyword", "ThisKeyword", "TrueKeyword", "SuperKeyword", "NonNullExpression", "ExpressionWithTypeArguments", "MetaProperty", "ImportKeyword",
  "MissingDeclaration"]);

export const stats = new Map();
const note = k => stats.set(k, (stats.get(k) ?? 0) + 1);

const C = (n, name) => n?.children.get(name);
const text = n => n?.scalars.get("Text")?.s ?? "";
const isIdentifier = n => n?.kind === "Identifier";
const kindOf = (n, name) => n.scalars.get(name)?.k;

export function forEachChild(n, f) {
  for (const c of n.children.values()) {
    if (c.list) for (const x of c.nodes) f(x);
    else f(c);
  }
}
export function setParents(n) {
  forEachChild(n, c => { c.parent = n; setParents(c); });
  for (const j of n.jsdoc) { j.parent = n; setParents(j); }
}
function overrideParentInImmediateChildren(n) { forEachChild(n, c => { c.parent = n; }); }

function cloneNode(n) {
  const c = mk(n.kind, n.pos, n.end, n.flags);
  for (const [k, v] of n.scalars) c.scalars.set(k, { ...v });
  for (const [k, v] of n.children) {
    if (v.list) { const l = { ...v, nodes: v.nodes.map(cloneNode) }; c.children.set(k, l); for (const x of l.nodes) x.parent = c; }
    else { const x = cloneNode(v); x.parent = c; c.children.set(k, x); }
  }
  return c;
}
function cloneModifiers(l) {
  if (!l) return undefined;
  return { ...l, nodes: l.nodes.map(cloneNode) };
}
const isValidIdentifier = s => {
  if (s.length === 0) return false;
  let i = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (i === 0 ? !ts.isIdentifierStart(cp, ts.ScriptTarget.Latest) : !ts.isIdentifierPart(cp, ts.ScriptTarget.Latest)) return false;
    i++;
  }
  return true;
};

function isAccessExpression(n) { return n.kind === "PropertyAccessExpression" || n.kind === "ElementAccessExpression"; }
function skipParentheses(n) { while (n.kind === "ParenthesizedExpression") n = C(n, "Expression"); return n; }
const isStringOrNumericLiteralLike = n => n.kind === "StringLiteral" || n.kind === "NoSubstitutionTemplateLiteral" || n.kind === "NumericLiteral";
function getElementOrPropertyAccessName(n) {
  if (n.kind === "PropertyAccessExpression") return isIdentifier(C(n, "name")) ? C(n, "name") : undefined;
  const arg = skipParentheses(C(n, "ArgumentExpression"));
  return isStringOrNumericLiteralLike(arg) ? arg : undefined;
}
const isModuleIdentifier = n => isIdentifier(n) && text(n) === "module";
const isExportsIdentifier = n => isIdentifier(n) && text(n) === "exports";
function isModuleExportsAccessExpression(n) {
  if (isAccessExpression(n) && isModuleIdentifier(C(n, "Expression"))) { const name = getElementOrPropertyAccessName(n); if (name) return text(name) === "exports"; }
  return false;
}
function isEntityNameExpressionEx(n, allowJS) {
  return isIdentifier(n) || (n.kind === "PropertyAccessExpression" && isIdentifier(C(n, "name")) && isEntityNameExpressionEx(C(n, "Expression"), allowJS)) ||
    (allowJS && (n.kind === "ThisKeyword" || (n.kind === "ElementAccessExpression" && isStringOrNumericLiteralLike(C(n, "ArgumentExpression")) && isEntityNameExpressionEx(C(n, "Expression"), allowJS))));
}
// ast.GetAssignmentDeclarationKind for a binary expression: true when the kind is not None.
function isAssignmentDeclaration(bin) {
  const left = C(bin, "Left"), right = C(bin, "Right");
  if (C(bin, "OperatorToken").kind !== "EqualsToken" || !isAccessExpression(left)) return false;
  const js = (left.flags & GOF.JavaScriptFile) !== 0;
  if (js) {
    if (isModuleExportsAccessExpression(left) && !isExportsIdentifier(right)) return true;
    const le = C(left, "Expression");
    if ((isModuleExportsAccessExpression(le) || isExportsIdentifier(le)) && getElementOrPropertyAccessName(left)) return true;
    if (le.kind === "ThisKeyword") return true;
  }
  return (left.kind === "PropertyAccessExpression" && isEntityNameExpressionEx(C(left, "Expression"), js) && isIdentifier(C(left, "name"))) ||
    (left.kind === "ElementAccessExpression" && isEntityNameExpressionEx(C(left, "Expression"), js));
}
const ASSIGN_OPS = new Set(["EqualsToken", "PlusEqualsToken", "MinusEqualsToken", "AsteriskAsteriskEqualsToken", "AsteriskEqualsToken", "SlashEqualsToken", "PercentEqualsToken",
  "AmpersandEqualsToken", "BarEqualsToken", "CaretEqualsToken", "LessThanLessThanEqualsToken", "GreaterThanGreaterThanGreaterThanEqualsToken", "GreaterThanGreaterThanEqualsToken",
  "BarBarEqualsToken", "AmpersandAmpersandEqualsToken", "QuestionQuestionEqualsToken"]);
function getRightMostAssignedExpression(n) {
  while (n.kind === "BinaryExpression" && ASSIGN_OPS.has(C(n, "OperatorToken").kind) && LHS.has(C(n, "Left").kind)) n = C(n, "Right");
  return n;
}
function hasSamePropertyAccessName(a, b) {
  if (a.kind === "Identifier" && b.kind === "Identifier") return text(a) === text(b);
  if (a.kind === "PropertyAccessExpression" && b.kind === "PropertyAccessExpression") return text(C(a, "name")) === text(C(b, "name")) && hasSamePropertyAccessName(C(a, "Expression"), C(b, "Expression"));
  return false;
}

class Reparser {
  constructor() {
    this.contextFlags = 0;
    this.reparseList = [];
    this.reparsedClones = [];
    this.inObjectLiteral = 0;
    this.internal = [];
    this.diagnostics = [];
  }
  newNode(kind, scalars) {
    const n = mk(kind, -1, -1, 0);
    if (scalars) for (const [k, v] of Object.entries(scalars)) n.scalars.set(k, v);
    return n;
  }
  newIdentifier(t) { return this.newNode("Identifier", { Text: { s: t } }); }
  newNodeList(pos, end, nodes) { return { list: true, pos, end, nodes }; }
  newModifierList(pos, end, nodes) { return { list: true, modifiers: true, modifierFlags: modifiersToFlags(nodes), pos, end, nodes }; }
  finishReparsedNode(node, loc) {
    node.flags = (this.contextFlags | GOF.Reparsed) >>> 0;
    node.pos = loc.pos; node.end = loc.end;
    overrideParentInImmediateChildren(node);
  }
  finishMutatedNode(node) { overrideParentInImmediateChildren(node); }
  deepCloneReparse(node) {
    if (!node) return undefined;
    const c = cloneNode(node);
    c.flags = (c.flags | GOF.Reparsed) >>> 0;
    return c;
  }
  addDeepCloneReparse(node) {
    const c = this.deepCloneReparse(node);
    if (c) this.reparsedClones.push(c);
    return c;
  }
  addTransformedReparse(newNode, old) {
    this.finishReparsedNode(newNode, old);
    newNode.flags = (newNode.flags | GOF.ReparserTransformedLiteral) >>> 0;
    this.reparsedClones.push(newNode);
    return newNode;
  }
  checkNonIdentifierName(name) {
    if (isIdentifier(name) && !isValidIdentifier(text(name))) {
      let pos = name.pos, end = name.end;
      if (end - pos === 0) { pos = name.pos - 1; end = name.pos; }
      this.diagnostics.push({ pos, end, code: 1003 });
      this.hasParseError = true;
    }
    return name;
  }
  setChild(n, name, v) { if (v === undefined || v === null) n.children.delete(name); else n.children.set(name, v); }
  attachJSDoc(node, jsDocs) { node.jsdoc = jsDocs; node.flags = (node.flags | GOF.HasJSDoc) >>> 0; }

  reparseTags(parent, jsDoc) {
    for (const j of jsDoc) {
      const isLast = j === jsDoc[jsDoc.length - 1];
      const tags = C(j, "Tags");
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
        const typeExpression = C(tag, "TypeExpression");
        if (!typeExpression) break;
        const fullName = C(tag, "name");
        const isNamespace = fullName && fullName.kind === "ModuleDeclaration";
        const modifiers = isNamespace ? this.createExportModifier(tag) : undefined;
        const typeAlias = this.newNode("JSTypeAliasDeclaration");
        this.setChild(typeAlias, "modifiers", modifiers);
        this.setChild(typeAlias, "name", this.addDeepCloneReparse(this.checkNonIdentifierName(this.getInnermostNameOfJSDocNamespace(fullName))));
        this.setChild(typeAlias, "TypeParameters", this.gatherTypeParameters(jsDoc, true));
        let t;
        switch (typeExpression.kind) {
          case "JSDocTypeExpression": t = this.addDeepCloneReparse(C(typeExpression, "Type")); break;
          case "JSDocTypeLiteral": t = this.reparseJSDocTypeLiteral(typeExpression); break;
          default: this.internal.push("typedef tag type expression " + typeExpression.kind); note("internal:typedef-type-expression"); return;
        }
        this.setChild(typeAlias, "Type", t);
        this.finishReparsedNode(typeAlias, tag);
        this.attachJSDoc(typeAlias, [jsDoc]);
        this.reparseList.push(this.wrapInJSDocNamespace(fullName, typeAlias, false));
        note("unhosted:typedef");
        break;
      }
      case "JSDocCallbackTag": {
        const typeExpression = C(tag, "TypeExpression");
        if (!typeExpression) break;
        const fullName = C(tag, "name");
        const isNamespace = fullName && fullName.kind === "ModuleDeclaration";
        const modifiers = isNamespace ? this.createExportModifier(tag) : undefined;
        const functionType = this.reparseJSDocSignature(typeExpression, tag, jsDoc, tag, undefined);
        if (!functionType) return;
        const typeAlias = this.newNode("JSTypeAliasDeclaration");
        this.setChild(typeAlias, "modifiers", modifiers);
        this.setChild(typeAlias, "name", this.addDeepCloneReparse(this.getInnermostNameOfJSDocNamespace(fullName)));
        this.setChild(typeAlias, "Type", functionType);
        this.setChild(typeAlias, "TypeParameters", this.gatherTypeParameters(jsDoc, true));
        this.finishReparsedNode(typeAlias, tag);
        this.attachJSDoc(typeAlias, [jsDoc]);
        this.reparseList.push(this.wrapInJSDocNamespace(fullName, typeAlias, false));
        note("unhosted:callback");
        break;
      }
      case "JSDocImportTag": {
        if (!C(tag, "ImportClause")) break;
        const importClause = this.addDeepCloneReparse(C(tag, "ImportClause"));
        importClause.scalars.set("PhaseModifier", { k: "TypeKeyword" });
        const d = this.newNode("JSImportDeclaration");
        this.setChild(d, "modifiers", cloneModifiers(C(tag, "modifiers")));
        this.setChild(d, "ImportClause", importClause);
        this.setChild(d, "ModuleSpecifier", this.addDeepCloneReparse(C(tag, "ModuleSpecifier")));
        this.setChild(d, "Attributes", this.addDeepCloneReparse(C(tag, "Attributes")));
        this.finishReparsedNode(d, tag);
        this.reparseList.push(d);
        note("unhosted:import");
        break;
      }
      case "JSDocOverloadTag":
        if ((parent.kind === "FunctionDeclaration" || parent.kind === "MethodDeclaration" || parent.kind === "Constructor") && this.inObjectLiteral === 0) {
          const s = this.reparseJSDocSignature(C(tag, "TypeExpression"), parent, jsDoc, tag, C(parent, "modifiers"));
          if (s) { this.reparseList.push(s); note("unhosted:overload"); }
        }
        break;
    }
  }

  reparseJSDocSignature(jsSignature, fun, jsDoc, tag, modifiers) {
    let signature;
    const clonedModifiers = cloneModifiers(modifiers);
    switch (fun.kind) {
      case "FunctionDeclaration":
        signature = this.newNode("FunctionDeclaration");
        this.setChild(signature, "modifiers", clonedModifiers);
        this.setChild(signature, "name", this.deepCloneReparse(this.checkNonIdentifierName(C(fun, "name"))));
        break;
      case "MethodDeclaration":
        signature = this.newNode("MethodDeclaration");
        this.setChild(signature, "modifiers", clonedModifiers);
        this.setChild(signature, "name", this.deepCloneReparse(this.checkNonIdentifierName(C(fun, "name"))));
        break;
      case "Constructor":
        signature = this.newNode("Constructor");
        this.setChild(signature, "modifiers", clonedModifiers);
        break;
      case "JSDocCallbackTag": {
        signature = this.newNode("FunctionType");
        this.setChild(signature, "Type", this.newNode("AnyKeyword"));
        break;
      }
      default: this.internal.push("Unexpected kind " + fun.kind); note("internal:signature-kind"); return undefined;
    }
    if (tag.kind !== "JSDocCallbackTag") this.setChild(signature, "TypeParameters", this.gatherTypeParameters(jsDoc, false));
    const parameters = [];
    const sigParams = C(jsSignature, "Parameters");
    let pi = -1;
    for (const param of sigParams?.nodes ?? []) {
      pi++;
      let parameter;
      if (param.kind === "JSDocThisTag") {
        const thisIdent = this.newIdentifier("this");
        thisIdent.pos = param.pos; thisIdent.end = param.end;
        thisIdent.flags = (this.contextFlags | GOF.Reparsed) >>> 0;
        parameter = this.newNode("Parameter");
        this.setChild(parameter, "name", thisIdent);
        const te = C(param, "TypeExpression");
        if (te) this.setChild(parameter, "Type", this.addDeepCloneReparse(C(te, "Type")));
      } else if (param.kind === "JSDocParameterTag" || param.kind === "JSDocPropertyTag") {
        if (C(param, "name").kind === "QualifiedName") continue;
        let dotDotDotToken, paramType;
        const te = C(param, "TypeExpression");
        if (te) {
          const tt = C(te, "Type");
          if (tt.kind === "JSDocVariadicType") {
            dotDotDotToken = this.newNode("DotDotDotToken");
            dotDotDotToken.pos = param.pos; dotDotDotToken.end = param.end;
            dotDotDotToken.flags = (this.contextFlags | GOF.Reparsed) >>> 0;
            paramType = this.reparseJSDocTypeLiteral(C(tt, "Type"));
          } else paramType = this.reparseJSDocTypeLiteral(tt);
        }
        let name = C(param, "name");
        if (isIdentifier(name) && !isValidIdentifier(text(name))) {
          let result = "", i = 0;
          for (const ch of text(name)) {
            const cp = ch.codePointAt(0);
            if (i === 0) result += ts.isIdentifierStart(cp, ts.ScriptTarget.Latest) ? ch : "_";
            else result += ts.isIdentifierPart(cp, ts.ScriptTarget.Latest) ? ch : "_";
            i++;
          }
          if (result.length === 0) result = "_" + pi;
          name = this.addTransformedReparse(this.newIdentifier(result), name);
        } else name = this.addDeepCloneReparse(name);
        parameter = this.newNode("Parameter");
        this.setChild(parameter, "DotDotDotToken", dotDotDotToken);
        this.setChild(parameter, "name", name);
        this.setChild(parameter, "QuestionToken", this.makeQuestionIfOptional(param));
        this.setChild(parameter, "Type", paramType);
      }
      if (!parameter) { this.internal.push("nil parameter for " + param.kind); note("internal:nil-parameter"); continue; }
      this.finishReparsedNode(parameter, param);
      parameters.push(parameter);
      this.reparseJSDocComment(parameter, param);
    }
    signature.children.set("Parameters", this.newNodeList(sigParams ? sigParams.pos : -1, sigParams ? sigParams.end : -1, parameters));
    const ret = C(jsSignature, "Type");
    if (ret && C(ret, "TypeExpression")) this.setChild(signature, "Type", this.addDeepCloneReparse(C(C(ret, "TypeExpression"), "Type")));
    const loc = tag.kind === "JSDocOverloadTag" ? C(tag, "TagName") : jsSignature;
    this.finishReparsedNode(signature, loc);
    return signature;
  }

  reparseJSDocTypeLiteral(t) {
    if (!t) return undefined;
    if (t.kind === "JSDocTypeLiteral") {
      const isArrayType = !!t.scalars.get("IsArrayType")?.b;
      const properties = [];
      for (const prop of C(t, "JSDocPropertyTags")?.nodes ?? []) {
        if (prop.kind !== "JSDocPropertyTag" && prop.kind !== "JSDocParameterTag") continue;
        let name = C(prop, "name");
        if (name.kind === "QualifiedName") name = C(name, "Right");
        if (isIdentifier(name) && !isValidIdentifier(text(name))) {
          name = this.addTransformedReparse(this.newNode("StringLiteral", { Text: { s: text(name) }, TokenFlags: { x: 0 } }), name);
        } else name = this.addDeepCloneReparse(name);
        const property = this.newNode("PropertySignature");
        this.setChild(property, "name", name);
        this.setChild(property, "PostfixToken", this.makeQuestionIfOptional(prop));
        const te = C(prop, "TypeExpression");
        if (te) this.setChild(property, "Type", this.reparseJSDocTypeLiteral(C(te, "Type")));
        this.finishReparsedNode(property, prop);
        properties.push(property);
        this.reparseJSDocComment(property, prop);
      }
      const lit = t;
      let r = this.newNode("TypeLiteral");
      r.children.set("Members", this.newNodeList(lit.pos, lit.end, properties));
      if (isArrayType) {
        this.finishReparsedNode(r, lit);
        const a = this.newNode("ArrayType");
        a.children.set("ElementType", r);
        r = a;
      }
      this.finishReparsedNode(r, lit);
      return r;
    }
    return this.addDeepCloneReparse(t);
  }

  reparseJSDocComment(node, tag) {
    const comment = C(tag, "Comment");
    if (comment) {
      const propJSDoc = this.newNode("JSDoc");
      propJSDoc.children.set("Comment", { ...comment, nodes: comment.nodes.map(x => this.deepCloneReparse(x)) });
      this.finishReparsedNode(propJSDoc, tag);
      propJSDoc.parent = node;
      this.attachJSDoc(node, [propJSDoc]);
    }
  }

  gatherTypeParameters(j, typedefOrCallback) {
    let typeParameters;
    let pos = -1, endPos = -1, firstTemplate = true;
    for (const tag of C(j, "Tags").nodes) {
      if (!typedefOrCallback && (tag.kind === "JSDocTypedefTag" || tag.kind === "JSDocCallbackTag")) return undefined;
      if (tag.kind !== "JSDocTemplateTag") continue;
      if (firstTemplate) { pos = tag.pos; firstTemplate = false; }
      endPos = tag.end;
      const constraint = C(tag, "Constraint");
      let firstTypeParameter = true;
      for (const tp of C(tag, "TypeParameters")?.nodes ?? []) {
        let reparse;
        if (constraint && firstTypeParameter) {
          reparse = this.newNode("TypeParameter");
          this.setChild(reparse, "modifiers", cloneModifiers(C(tp, "modifiers")));
          this.setChild(reparse, "name", this.addDeepCloneReparse(this.checkNonIdentifierName(C(tp, "name"))));
          this.setChild(reparse, "Constraint", this.addDeepCloneReparse(C(constraint, "Type")));
          this.setChild(reparse, "DefaultType", this.addDeepCloneReparse(C(tp, "DefaultType")));
          this.finishReparsedNode(reparse, tp);
        } else reparse = this.addDeepCloneReparse(tp);
        (typeParameters ??= []).push(reparse);
        firstTypeParameter = false;
      }
    }
    if (!typeParameters || typeParameters.length === 0) return undefined;
    return this.newNodeList(pos, endPos, typeParameters);
  }

  reparseHosted(tag, parent, jsDoc) {
    const te = C(tag, "TypeExpression");
    switch (tag.kind) {
      case "JSDocTypeTag": {
        switch (parent.kind) {
          case "VariableStatement": {
            const dl = C(parent, "DeclarationList");
            if (dl) for (const declaration of C(dl, "Declarations").nodes) {
              if (!C(declaration, "Type") && te) {
                declaration.children.set("Type", this.addDeepCloneReparse(C(te, "Type")));
                this.finishMutatedNode(declaration);
                note("hosted:type:variable-statement");
                return;
              }
            }
            break;
          }
          case "VariableDeclaration": case "ExportAssignment": case "PropertyDeclaration": case "PropertyAssignment": case "ShorthandPropertyAssignment": case "GetAccessor":
            if (!C(parent, "Type") && te) {
              parent.children.set("Type", this.addDeepCloneReparse(C(te, "Type")));
              this.finishMutatedNode(parent);
              note("hosted:type:" + parent.kind);
              return;
            }
            break;
          case "Parameter":
            if (!C(parent, "Type") && te) {
              parent.children.set("Type", this.reparseJSDocTypeLiteral(C(te, "Type")));
              this.finishMutatedNode(parent);
              note("hosted:type:Parameter");
              return;
            }
            break;
          case "ExpressionStatement": {
            const e = C(parent, "Expression");
            if (e.kind === "BinaryExpression" && isAssignmentDeclaration(e) && te) {
              e.children.set("Type", this.addDeepCloneReparse(C(te, "Type")));
              this.finishMutatedNode(e);
              note("hosted:type:assignment");
              return;
            }
            break;
          }
          case "ReturnStatement": case "ParenthesizedExpression":
            if (C(parent, "Expression") && te) {
              parent.children.set("Expression", this.makeNewCast(this.addDeepCloneReparse(C(te, "Type")), C(parent, "Expression"), true));
              this.finishMutatedNode(parent);
              note("hosted:type:cast");
              return;
            }
            break;
        }
        const fun = getFunctionLikeHost(parent);
        if (fun) {
          const noTypedParams = (C(fun, "Parameters")?.nodes ?? []).every(p => !C(p, "Type"));
          if (!C(fun, "TypeParameters") && !C(fun, "Type") && noTypedParams && te) {
            fun.children.set("FullSignature", this.addDeepCloneReparse(C(te, "Type")));
            this.finishMutatedNode(fun);
            note("hosted:type:full-signature");
          }
        }
        break;
      }
      case "JSDocSatisfiesTag": {
        switch (parent.kind) {
          case "VariableStatement": {
            const dl = C(parent, "DeclarationList");
            if (dl) for (const declaration of C(dl, "Declarations").nodes) {
              if (C(declaration, "Initializer") && te) {
                declaration.children.set("Initializer", this.makeNewCast(this.addDeepCloneReparse(C(te, "Type")), C(declaration, "Initializer"), false));
                this.finishMutatedNode(declaration);
                note("hosted:satisfies");
                break;
              }
            }
            break;
          }
          case "VariableDeclaration": case "PropertyDeclaration": case "PropertyAssignment":
            if (C(parent, "Initializer") && te) {
              parent.children.set("Initializer", this.makeNewCast(this.addDeepCloneReparse(C(te, "Type")), C(parent, "Initializer"), false));
              this.finishMutatedNode(parent);
              note("hosted:satisfies");
            }
            break;
          case "ShorthandPropertyAssignment":
            if (C(parent, "ObjectAssignmentInitializer") && te) {
              parent.children.set("ObjectAssignmentInitializer", this.makeNewCast(this.addDeepCloneReparse(C(te, "Type")), C(parent, "ObjectAssignmentInitializer"), false));
              this.finishMutatedNode(parent);
              note("hosted:satisfies");
            }
            break;
          case "ReturnStatement": case "ParenthesizedExpression": case "ExportAssignment":
            if (C(parent, "Expression") && te) {
              parent.children.set("Expression", this.makeNewCast(this.addDeepCloneReparse(C(te, "Type")), C(parent, "Expression"), false));
              this.finishMutatedNode(parent);
              note("hosted:satisfies");
            }
            break;
          case "ExpressionStatement": {
            const bin = C(parent, "Expression");
            if (bin.kind === "BinaryExpression" && isAssignmentDeclaration(bin) && te) {
              bin.children.set("Right", this.makeNewCast(this.addDeepCloneReparse(C(te, "Type")), C(bin, "Right"), false));
              this.finishMutatedNode(bin);
              note("hosted:satisfies");
            }
            break;
          }
        }
        break;
      }
      case "JSDocTemplateTag": {
        const fun = getFunctionLikeHost(parent);
        if (fun) {
          if (!C(fun, "TypeParameters") && !C(fun, "FullSignature")) {
            this.setChild(fun, "TypeParameters", this.gatherTypeParameters(jsDoc, false));
            this.finishMutatedNode(fun);
            note("hosted:template:function");
          }
        } else if (parent.kind === "ClassDeclaration" || parent.kind === "ClassExpression") {
          if (!C(parent, "TypeParameters")) {
            this.setChild(parent, "TypeParameters", this.gatherTypeParameters(jsDoc, false));
            this.finishMutatedNode(parent);
            note("hosted:template:class");
          }
        }
        break;
      }
      case "JSDocParameterTag": {
        const fun = getFunctionLikeHost(parent);
        if (fun && !C(fun, "FullSignature")) {
          const param = findMatchingParameter(fun, tag, jsDoc);
          if (param) {
            if (!C(param, "Type") && te) this.setChild(param, "Type", this.reparseJSDocTypeLiteral(C(te, "Type")));
            if (!C(param, "QuestionToken")) { const q = this.makeQuestionIfOptional(tag); if (q) param.children.set("QuestionToken", q); }
            this.finishMutatedNode(param);
            note("hosted:param");
          }
        }
        break;
      }
      case "JSDocThisTag": {
        const fun = getFunctionLikeHost(parent);
        if (fun) {
          const params = C(fun, "Parameters")?.nodes ?? [];
          const first = params[0] && C(params[0], "name");
          if (params.length === 0 || (first.kind !== "ThisKeyword" && !(isIdentifier(first) && text(first) === "this"))) {
            const thisParam = this.newNode("Parameter");
            thisParam.children.set("name", this.newIdentifier("this"));
            if (te) thisParam.children.set("Type", this.addDeepCloneReparse(C(te, "Type")));
            this.finishReparsedNode(thisParam, C(tag, "TagName"));
            const old = C(fun, "Parameters");
            fun.children.set("Parameters", this.newNodeList(old ? old.pos : -1, old ? old.end : -1, [thisParam, ...params]));
            this.finishMutatedNode(fun);
            note("hosted:this");
          }
        }
        break;
      }
      case "JSDocReturnTag": {
        const fun = getFunctionLikeHost(parent);
        if (fun && !C(fun, "FullSignature")) {
          if (!C(fun, "Type") && te) {
            fun.children.set("Type", this.addDeepCloneReparse(C(te, "Type")));
            this.finishMutatedNode(fun);
            note("hosted:return");
          }
        }
        break;
      }
      case "JSDocReadonlyTag": case "JSDocPrivateTag": case "JSDocPublicTag": case "JSDocProtectedTag": case "JSDocOverrideTag": {
        if (parent.kind === "ExpressionStatement") parent = C(parent, "Expression");
        switch (parent.kind) {
          case "MethodDeclaration": case "GetAccessor": case "SetAccessor":
            if (this.inObjectLiteral !== 0) return;
          // falls through
          case "PropertyDeclaration": case "Constructor": case "BinaryExpression": {
            const keyword = { JSDocReadonlyTag: "ReadonlyKeyword", JSDocPrivateTag: "PrivateKeyword", JSDocPublicTag: "PublicKeyword", JSDocProtectedTag: "ProtectedKeyword", JSDocOverrideTag: "OverrideKeyword" }[tag.kind];
            const modifier = this.newNode(keyword);
            modifier.pos = tag.pos; modifier.end = tag.end;
            modifier.flags = (this.contextFlags | GOF.Reparsed) >>> 0;
            const mods = C(parent, "modifiers");
            let nodes, pos, end;
            if (!mods) { nodes = [modifier]; pos = tag.pos; end = tag.end; }
            else { nodes = [...mods.nodes, modifier]; pos = mods.pos; end = mods.end; }
            parent.children.set("modifiers", this.newModifierList(pos, end, nodes));
            this.finishMutatedNode(parent);
            note("hosted:modifier");
          }
        }
        break;
      }
      case "JSDocImplementsTag": {
        if (parent.kind === "ClassDeclaration" || parent.kind === "ClassExpression") {
          const className = C(tag, "ClassName");
          const hc = C(parent, "HeritageClauses");
          if (hc) {
            const implementsClause = hc.nodes.find(n => kindOf(n, "Token") === "ImplementsKeyword");
            if (implementsClause) {
              C(implementsClause, "Types").nodes.push(this.addDeepCloneReparse(className));
              this.finishMutatedNode(implementsClause);
              note("hosted:implements:append");
              return;
            }
          }
          const typesList = this.newNodeList(className.pos, className.end, [this.addDeepCloneReparse(className)]);
          const heritageClause = this.newNode("HeritageClause", { Token: { k: "ImplementsKeyword" } });
          heritageClause.children.set("Types", typesList);
          this.finishReparsedNode(heritageClause, className);
          if (!hc) parent.children.set("HeritageClauses", this.newNodeList(className.pos, className.end, [heritageClause]));
          else hc.nodes.push(heritageClause);
          this.finishMutatedNode(parent);
          note("hosted:implements:new");
        }
        break;
      }
      case "JSDocAugmentsTag": {
        if (parent.kind === "ClassDeclaration" || parent.kind === "ClassExpression") {
          const hc = C(parent, "HeritageClauses");
          const extendsClause = hc?.nodes.find(n => kindOf(n, "Token") === "ExtendsKeyword");
          if (extendsClause && C(extendsClause, "Types").nodes.length === 1) {
            const target = C(extendsClause, "Types").nodes[0];
            const source = C(tag, "ClassName");
            if (target.kind === "ExpressionWithTypeArguments" && hasSamePropertyAccessName(C(target, "Expression"), C(source, "Expression"))) {
              const sa = C(source, "TypeArguments");
              if (!C(target, "TypeArguments") && sa) {
                target.children.set("TypeArguments", this.newNodeList(sa.pos, sa.end, sa.nodes.map(a => this.addDeepCloneReparse(a))));
                this.finishMutatedNode(target);
                note("hosted:augments");
              }
            }
          }
        }
        break;
      }
    }
  }

  makeQuestionIfOptional(parameter) {
    const te = C(parameter, "TypeExpression");
    if (parameter.scalars.get("IsBracketed")?.b || (te && C(te, "Type").kind === "JSDocOptionalType")) {
      const q = this.newNode("QuestionToken");
      q.pos = parameter.pos; q.end = parameter.end;
      q.flags = (this.contextFlags | GOF.Reparsed) >>> 0;
      return q;
    }
    return undefined;
  }

  makeNewCast(t, e, isAssertion) {
    const a = this.newNode(isAssertion ? "AsExpression" : "SatisfiesExpression");
    a.children.set("Expression", e);
    a.children.set("Type", t);
    // finishNodeWithEnd: the context flags of the parser, and the pending error flag (not modelled).
    a.pos = e.pos; a.end = e.end;
    a.flags = (a.flags | this.contextFlags) >>> 0;
    overrideParentInImmediateChildren(a);
    return a;
  }

  createExportModifier(loc) {
    const m = this.newNode("ExportKeyword");
    m.pos = loc.pos; m.end = loc.end;
    m.flags = (this.contextFlags | GOF.Reparsed) >>> 0;
    return this.newModifierList(loc.pos, loc.end, [m]);
  }

  getInnermostNameOfJSDocNamespace(fullName) {
    if (!fullName) return undefined;
    while (fullName.kind === "ModuleDeclaration") {
      const body = C(fullName, "Body");
      if (!body) return C(fullName, "name");
      fullName = body;
    }
    return fullName;
  }

  wrapInJSDocNamespace(fullName, statement, nested) {
    if (!fullName || fullName.kind !== "ModuleDeclaration") return statement;
    const wrapped = this.wrapInJSDocNamespace(C(fullName, "Body"), statement, true);
    const block = this.newNode("ModuleBlock");
    block.children.set("Statements", this.newNodeList(fullName.pos, fullName.end, [wrapped]));
    this.finishReparsedNode(block, fullName);
    const modifiers = nested ? this.createExportModifier(fullName) : undefined;
    const result = this.newNode("ModuleDeclaration", { Keyword: { k: "NamespaceKeyword" } });
    this.setChild(result, "modifiers", modifiers);
    this.setChild(result, "name", this.addDeepCloneReparse(C(fullName, "name")));
    result.children.set("Body", block);
    this.finishReparsedNode(result, fullName);
    this.reparsedClones.push(result);
    return result;
  }
}

function findMatchingParameter(fun, parameterTag, jsDoc) {
  let tagIndex = -1, paramCount = -1;
  for (const tag of C(jsDoc, "Tags").nodes) {
    if (tag.kind === "JSDocParameterTag") {
      paramCount++;
      if (tag === parameterTag) { tagIndex = paramCount; break; }
    }
  }
  const params = C(fun, "Parameters")?.nodes ?? [];
  const tagName = C(parameterTag, "name");
  for (let parameterIndex = 0; parameterIndex < params.length; parameterIndex++) {
    const parameter = params[parameterIndex];
    const pname = C(parameter, "name");
    if (pname.kind === "Identifier") {
      if (tagName.kind === "Identifier" && (text(pname) === text(tagName) || (parameterIndex === tagIndex && text(tagName).length === 0))) return parameter;
    } else if (parameterIndex === tagIndex) return parameter;
  }
  return undefined;
}

function getFunctionLikeHost(host) {
  let fun = host;
  switch (host.kind) {
    case "VariableStatement": {
      const nodes = C(C(host, "DeclarationList"), "Declarations").nodes;
      if (nodes.length !== 0) fun = C(nodes[0], "Initializer");
      break;
    }
    case "PropertyAssignment": case "PropertyDeclaration": fun = C(host, "Initializer"); break;
    case "ExportAssignment": case "ReturnStatement": fun = C(host, "Expression"); break;
    case "ExpressionStatement": fun = getRightMostAssignedExpression(C(host, "Expression")); break;
  }
  while (fun && fun.kind === "SatisfiesExpression") fun = C(fun, "Expression");
  return fun && FUNCTION_LIKE.has(fun.kind) ? fun : undefined;
}

// Source order of the children of a node: by position, ties in the order of the Go struct.
function orderedChildren(n) {
  const order = byKind.get(n.kind)?.memberOrder ?? [];
  const entries = [...n.children.entries()].map(([name, c], i) => ({ name, c, pos: c.list ? (c.nodes.length ? c.nodes[0].pos : c.pos) : c.pos, rank: order.indexOf(name) < 0 ? 1000 + i : order.indexOf(name) }));
  entries.sort((a, b) => a.pos - b.pos || a.rank - b.rank);
  return entries;
}

// Visits the hosts in the order in which the parser finishes them and gives each statement list its reparsed statements.
export function reparse(root) {
  const r = new Reparser();
  function walk(n) {
    const isObj = n.kind === "ObjectLiteralExpression";
    if (isObj) r.inObjectLiteral++;
    for (const { name, c } of orderedChildren(n)) {
      if (n.kind === "SourceFile" && name === "EndOfFileToken") continue;
      const listKind = c.list ? PARSE_LISTS[n.kind]?.[name] : undefined;
      if (listKind) {
        const outer = r.reparseList;
        r.reparseList = [];
        const out = [];
        for (const elt of c.nodes) {
          walk(elt);
          if (r.reparseList.length !== 0) {
            for (const e of r.reparseList) {
              if ((e.kind === "JSTypeAliasDeclaration" || e.kind === "JSImportDeclaration") && listKind !== "SourceElements" && listKind !== "BlockStatements") outer.push(e);
              else { out.push(e); e.parent = n; }
            }
            r.reparseList = [];
          }
          out.push(elt);
        }
        c.nodes = out;
        r.reparseList = outer;
      } else if (c.list) { for (const x of c.nodes) walk(x); }
      else walk(c);
    }
    if (isObj) r.inObjectLiteral--;
    if (n.kind === "SourceFile") {
      const eof = C(n, "EndOfFileToken");
      finish(eof);
      host(eof);
      const st = C(n, "Statements");
      for (const e of r.reparseList) { st.nodes.push(e); e.parent = n; }
      r.reparseList = [];
      finish(n);
    } else { finish(n); host(n); }
  }
  // An error reported while reparsing is flagged on the next node that the parser finishes.
  function finish(n) {
    if (r.hasParseError) { n.flags = (n.flags | GOF.ThisNodeHasError) >>> 0; r.hasParseError = false; note("reparse-error-flag"); }
  }
  function host(n) {
    if (n.jsdoc.length === 0 || n.reparsedBy) return;
    r.contextFlags = (n.flags & contextFlagsMask()) >>> 0;
    r.reparseTags(n, n.jsdoc);
  }
  walk(root);
  root.reparsedClones = r.reparsedClones;
  root.reparseInternal = r.internal;
  root.reparseDiagnostics = r.diagnostics;
  return root;
}
