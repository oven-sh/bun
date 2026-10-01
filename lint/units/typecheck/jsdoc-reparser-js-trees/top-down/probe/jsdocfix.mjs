// Probe (route A): the rules that turn the JSDoc trees of TypeScript 6.0.2 into the trees of typescript-go's JSDoc parser.
import { GOF } from "./convert.mjs";
export const fixHits = new Map();
const hit = k => fixHits.set(k, (fixHits.get(k) ?? 0) + 1);
const get = (n, name) => n?.children.get(name);

const WS = new Set([0x20, 0x09, 0x0b, 0x0c]);
const NL = new Set([0x0a, 0x0d]);
// Parser.skipWhitespaceOrAsterisk over the bytes of a comment: returns the start of the token that is current afterwards.
function skipWhitespaceOrAsterisk(b, pos, end) {
  if (pos < end && (WS.has(b[pos]) || NL.has(b[pos]))) {
    let q = pos;
    while (q < end && (WS.has(b[q]) || NL.has(b[q]))) q++;
    if (q === end) return pos;
  }
  let precedingLineBreak = false;
  while (pos < end) {
    if (WS.has(b[pos])) { while (pos < end && WS.has(b[pos])) pos++; }
    else if (NL.has(b[pos])) { if (b[pos] === 0x0d && b[pos + 1] === 0x0a) pos++; pos++; precedingLineBreak = true; }
    else if (b[pos] === 0x2a && precedingLineBreak) { pos++; precedingLineBreak = false; }
    else break;
  }
  return pos;
}
function mkMissingIdentifier(pos, flags) {
  return { kind: "Identifier", pos, end: pos, flags: flags >>> 0, scalars: new Map([["Text", { s: "" }]]), children: new Map(), jsdoc: [] };
}

function fixTag(tag, jsdoc, index, tags, ctx) {
  const ts = tag.tsNode;
  switch (tag.kind) {
    case "JSDocTemplateTag": {
      // Rule template-type-parameters-range: the list is a zero value in typescript-go.
      const l = get(tag, "TypeParameters");
      if (l) { if (l.pos !== 0 || l.end !== 0) hit("template-type-parameters-range"); l.pos = 0; l.end = 0; }
      else { tag.children.set("TypeParameters", { list: true, pos: 0, end: 0, nodes: [] }); hit("template-type-parameters-empty"); }
      break;
    }
    case "JSDocTypedefTag": {
      // Rule typedef-type-literal-pos: the literal starts at its first property tag.
      const te = get(tag, "TypeExpression");
      if (te?.kind === "JSDocTypeLiteral") {
        const props = get(te, "JSDocPropertyTags")?.nodes ?? [];
        const pos = props.length ? props[0].pos : tag.pos;
        if (te.pos !== pos) { te.pos = pos; hit("typedef-type-literal-pos"); }
      }
      // Rule typedef-missing-name: typescript-go makes a missing identifier where TypeScript leaves the name out.
      if (!get(tag, "name")) {
        const from = te && te.kind === "JSDocTypeExpression" ? te.end : get(tag, "TagName").end;
        const pos = skipWhitespaceOrAsterisk(ctx.textBytes, from, jsdoc.end - 2);
        tag.children.set("name", mkMissingIdentifier(pos, tag.flags | GOF.ThisNodeHasError));
        hit("typedef-missing-name");
      }
      break;
    }
    case "JSDocCallbackTag": {
      // Rule callback-signature-pos: the signature starts where its parameter list starts.
      const sig = get(tag, "TypeExpression");
      const params = sig && get(sig, "Parameters");
      if (sig && params && sig.pos !== params.pos) { sig.pos = params.pos; hit("callback-signature-pos"); }
      break;
    }
    case "JSDocUnknownTag": {
      // Rule ts-only-tags: @enum, @author, @class are unknown tags whose text is their comment.
      if (ts && (ts.tsKind === "JSDocEnumTag" || ts.tsKind === "JSDocAuthorTag" || ts.tsKind === "JSDocClassTag")) {
        const next = tags[index + 1];
        const end = next ? next.pos : jsdoc.end - 2;
        if (ts.tsKind === "JSDocEnumTag") {
          if (tag.end !== end) { tag.end = end; hit("enum-tag-end"); }
          const c = get(tag, "Comment");
          const rest = ctx.textBytes.subarray(get(tag, "TagName").end, tag.end);
          const hasText = rest.some(c => !WS.has(c) && !NL.has(c) && c !== 0x2a);
          if (c && !hasText) { tag.children.delete("Comment"); hit("enum-tag-no-comment"); }
        }
      }
      break;
    }
    case "JSDocParameterTag": {
      // Rule missing-parameter-name: typescript-go reports no error for a parameter tag without a name.
      const name = get(tag, "name");
      if (name?.kind === "Identifier" && name.pos === name.end && (name.flags & GOF.ThisNodeHasError) && tag.parentTagKind !== "JSDocSignature") {
        name.flags = (name.flags & ~GOF.ThisNodeHasError) >>> 0; hit("missing-parameter-name");
      }
      break;
    }
  }
}

function skipWhitespace(b, pos, end) {
  let q = pos;
  while (q < end && (WS.has(b[q]) || NL.has(b[q]))) q++;
  return q === end ? pos : q;
}
// Rule tag-comment-range: where Parser.parseTagComments starts for a tag whose comment TypeScript keeps as a string.
function commentStartOf(tag, jsdoc, ctx) {
  const b = ctx.textBytes, end = jsdoc.end - 2;
  const tagName = get(tag, "TagName");
  const te = get(tag, "TypeExpression");
  const afterName = skipWhitespaceOrAsterisk(b, tagName.end, end);
  switch (tag.kind) {
    case "JSDocParameterTag": case "JSDocPropertyTag": {
      const name = get(tag, "name");
      if (te && te.pos >= name.end && get(te, "Type")?.kind !== "JSDocTypeLiteral") return te.end;
      // The closing bracket of [name] or [name = value] and a closing backquote are consumed before the comment.
      let p = name.end;
      if (tag.scalars.get("IsBracketed")?.b) { while (p < end && b[p] !== 0x5d) p++; if (p < end) p++; }
      else if (b[p] === 0x60) p++;
      return skipWhitespaceOrAsterisk(b, p, end);
    }
    case "JSDocReturnTag": case "JSDocThrowsTag":
      return te ? te.end : skipWhitespaceOrAsterisk(b, afterName, end);
    case "JSDocTypeTag": case "JSDocSatisfiesTag":
      return te ? te.end : afterName;
    case "JSDocThisTag":
      return te ? skipWhitespace(b, te.end, end) : afterName;
    case "JSDocImplementsTag": case "JSDocAugmentsTag": {
      const cn = get(tag, "ClassName");
      let p = cn.end;
      const q = skipWhitespace(b, p, end);
      if (b[q] === 0x7d) p = q + 1;
      return p;
    }
    case "JSDocSeeTag": {
      const ne = get(tag, "NameExpression");
      return ne ? ne.end : afterName;
    }
    case "JSDocUnknownTag": case "JSDocPublicTag": case "JSDocPrivateTag": case "JSDocProtectedTag": case "JSDocReadonlyTag": case "JSDocOverrideTag": case "JSDocDeprecatedTag":
      return afterName;
    default:
      return undefined;
  }
}
const hasContent = (b, from, to) => { for (let i = from; i < to; i++) if (!WS.has(b[i]) && !NL.has(b[i]) && b[i] !== 0x2a) return true; return false; };
function fixTagComments(tag, jsdoc, ctx) {
  const c = get(tag, "Comment");
  if (c && c.approximate) {
    const b = ctx.textBytes;
    let pos = commentStartOf(tag, jsdoc, ctx), end = tag.end;
    const te = get(tag, "TypeExpression");
    if ((tag.kind === "JSDocParameterTag" || tag.kind === "JSDocPropertyTag") && te && get(te, "Type")?.kind === "JSDocTypeLiteral") end = te.pos;
    if (tag.kind === "JSDocTypedefTag" || tag.kind === "JSDocCallbackTag" || tag.kind === "JSDocOverloadTag") {
      // The comment is read after the name; when there is none there, after the child tags.
      const name = get(tag, "name") ?? get(tag, "TagName");
      let firstChild;
      if (te?.kind === "JSDocSignature") firstChild = get(te, "Parameters")?.pos;
      else if (te?.kind === "JSDocTypeLiteral") firstChild = te.pos;
      const from = skipWhitespace(b, name.end, jsdoc.end - 2);
      if (firstChild !== undefined && firstChild >= from) {
        if (hasContent(b, from, firstChild)) { pos = from; end = firstChild; }
        else { pos = te.end; end = tag.end; }
      } else if (firstChild === undefined && (!te || te.end <= name.pos)) { pos = from; end = tag.end; }
    }
    if (pos !== undefined) {
      c.pos = pos; c.end = end;
      for (const t of c.nodes) { t.pos = pos; t.end = end; }
      // The text of a tag that only typescript-go treats as unknown is the source of the rest of its line.
      if (tag.tsNode?.tsKind === "JSDocEnumTag" && c.nodes.length === 1) {
        const raw = Buffer.from(b.subarray(pos, end)).toString("utf8");
        if (!/[\r\n]/.test(raw.trimEnd())) c.nodes[0].scalars.set("text", { s: raw.trim() });
      }
      hit("tag-comment-range");
    } else hit("tag-comment-range:not-derived:" + tag.kind);
  }
  for (const v of tag.children.values()) {
    if (v.list) { for (const x of v.nodes) if (/^JSDoc\w+Tag$/.test(x.kind)) fixTagComments(x, jsdoc, ctx); else walkInner(x, jsdoc, ctx); }
    else if (/^JSDoc\w+Tag$/.test(v.kind)) fixTagComments(v, jsdoc, ctx); else walkInner(v, jsdoc, ctx);
  }
}
function walkInner(g, jsdoc, ctx) {
  for (const v of g.children.values()) {
    if (v.list) { for (const x of v.nodes) if (/^JSDoc\w+Tag$/.test(x.kind)) fixTagComments(x, jsdoc, ctx); else walkInner(x, jsdoc, ctx); }
    else if (/^JSDoc\w+Tag$/.test(v.kind)) fixTagComments(v, jsdoc, ctx); else walkInner(v, jsdoc, ctx);
  }
}

function fixJSDocNode(j, ctx) {
  const tagList = get(j, "Tags");
  const tags = tagList?.nodes ?? [];
  tags.forEach((t, i) => fixTag(t, j, i, tags, ctx));
  for (const t of tags) fixTagComments(t, j, ctx);
  // Rule tags-range: the list of tags ends where its last tag ends.
  if (tagList && tags.length && tagList.end !== tags[tags.length - 1].end) { tagList.end = tags[tags.length - 1].end; hit("tags-range"); }
  // Rule text-after-last-link: without tags, what follows the last link is a text node even when it is only white space.
  const comment = get(j, "Comment");
  if (comment && !tagList && comment.nodes.length) {
    const last = comment.nodes[comment.nodes.length - 1];
    if (last.kind !== "JSDocText" && last.end < j.end - 2) {
      comment.nodes.push({ kind: "JSDocText", pos: last.end, end: comment.end, flags: last.flags, scalars: new Map([["text", { s: "" }]]), children: new Map(), jsdoc: [] });
      hit("text-after-last-link");
    }
  }
  // Rule type-expression-without-braces: typescript-go reports one error, on the first node of the type.
  (function walkTE(g) {
    if (g.kind === "JSDocTypeExpression" && (g.flags & GOF.ThisNodeHasError) && ctx.textBytes[skipWhitespaceOrAsterisk(ctx.textBytes, g.pos, g.end)] !== 0x7b) {
      g.flags = (g.flags & ~GOF.ThisNodeHasError) >>> 0; hit("type-expression-without-braces");
    }
    for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) walkTE(x); else walkTE(c); }
  })(j);
  // Nodes below the tags.
  (function walk(g) {
    // Rule jsdoc-namespace-keyword: the name of a typedef with dots is made of namespace declarations.
    if (g.kind === "ModuleDeclaration") {
      if (g.scalars.get("Keyword")?.k !== "NamespaceKeyword") { g.scalars.set("Keyword", { k: "NamespaceKeyword" }); hit("jsdoc-namespace-keyword"); }
      g.children.delete("modifiers");
      if (g.tsNode && g.tsNode.tsFlags & (1 << 3)) g.flags = (g.flags | GOF.OptionalChain) >>> 0;
    }
    for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) walk(x); else walk(c); }
  })(j);
}

export function fixJSDoc(root, ctx) {
  (function walk(g) {
    for (const c of g.children.values()) { if (c.list) for (const x of c.nodes) walk(x); else walk(c); }
    for (const j of g.jsdoc) fixJSDocNode(j, ctx);
    if (ctx.isJS) {
      // Rule js-has-jsdoc: in a JavaScript file the flags follow the comments that were parsed, not the scanner.
      const had = g.flags;
      let f = g.flags & ~(GOF.HasJSDoc | GOF.PossiblyContainsDeprecatedTag);
      if (g.jsdoc.length) {
        f |= GOF.HasJSDoc;
        if (g.jsdoc.some(j => (j.children.get("Tags")?.nodes ?? []).some(t => t.kind === "JSDocDeprecatedTag"))) f |= GOF.PossiblyContainsDeprecatedTag;
      }
      g.flags = f >>> 0;
      if (g.flags !== had) hit("js-has-jsdoc");
    }
  })(root);
}
