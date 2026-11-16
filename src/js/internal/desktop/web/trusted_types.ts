// https://w3c.github.io/trusted-types/dist/spec/
const idl = require("internal/desktop/web/idl");
const core = require("internal/desktop/web/dom").core;

const { expose, internal, need, scope } = idl;
const { asciiLower, namespaces } = core;

type Kind = "html" | "script" | "scriptURL";
/** On the object, where all realms find it. */
const dataOf = (value: any, kind: Kind): string | undefined =>
  $isObject(value) && value.$impl?.trustedAs === kind ? value.$impl.data : undefined;

function trustedClass(name: string, kind: Kind) {
  const read = (self: unknown) => dataOf(self, kind) ?? idl.illegal(undefined);
  const constructor: any = {
    [name]: class {
      constructor(key: unknown = undefined, data = "") {
        idl.illegal(key);
        $putByIdDirectPrivate(this, "impl", { trustedAs: kind, data });
      }
      toString() {
        return read(this);
      }
      toJSON() {
        return read(this);
      }
    },
  }[name];
  return expose(constructor);
}

const classes = {
  html: trustedClass("TrustedHTML", "html"),
  script: trustedClass("TrustedScript", "script"),
  scriptURL: trustedClass("TrustedScriptURL", "scriptURL"),
};
const methods = { html: "createHTML", script: "createScript", scriptURL: "createScriptURL" };
const convert = (kind: Kind, value: unknown) => (kind === "scriptURL" ? idl.usv(value) : `${value}`);

class TrustedTypePolicy {
  #name: string;
  #options: any;

  constructor(key: unknown = undefined, name = "", options = {}) {
    idl.illegal(key);
    this.#name = name;
    this.#options = options;
  }

  get name() {
    return this.#name;
  }

  #create(kind: Kind, input: unknown, rest: unknown[]) {
    const create = this.#options[methods[kind]];
    input = convert(kind, input);
    if (!create)
      throw new TypeError(`Policy ${this.#name}'s TrustedTypePolicyOptions did not specify '${methods[kind]}'.`);
    return new classes[kind](internal, convert(kind, create(input, ...rest) ?? ""));
  }

  createHTML(input: string, ...rest: unknown[]) {
    need(arguments.length, 1);
    return this.#create("html", input, rest);
  }
  createScript(input: string, ...rest: unknown[]) {
    need(arguments.length, 1);
    return this.#create("script", input, rest);
  }
  createScriptURL(input: string, ...rest: unknown[]) {
    need(arguments.length, 1);
    return this.#create("scriptURL", input, rest);
  }
}
expose(TrustedTypePolicy);

const names = new Set<string>();
let defaultPolicy: TrustedTypePolicy | null = null;
let defaultOptions: any;

const [HTML, SVG, MATHML] = namespaces;
const XLINK = "http://www.w3.org/1999/xlink";

/** The kind and the name of the sink. */
function attributeSink(
  tag: string,
  elementNs: string | null,
  name: string,
  ns: string | null,
): [Kind, string] | undefined {
  if (
    ns === null &&
    name.startsWith("on") &&
    [HTML, SVG, MATHML].includes(elementNs) &&
    scope.isHandlerName(name.slice(2))
  ) {
    return ["script", "Element " + name];
  }
  if (elementNs === HTML && ns === null) {
    if (tag === "iframe" && name === "srcdoc") return ["html", "HTMLIFrameElement srcdoc"];
    if (tag === "script" && name === "src") return ["scriptURL", "HTMLScriptElement src"];
    if (tag === "embed" && name === "src") return ["scriptURL", "HTMLEmbedElement src"];
    if (tag === "object" && (name === "data" || name === "codebase")) return ["scriptURL", "HTMLObjectElement " + name];
  }
  if (elementNs === SVG && tag === "script" && name === "href" && (ns === null || ns === XLINK)) {
    return ["scriptURL", "SVGScriptElement href"];
  }
}

const properties = {
  "* innerHTML": "html",
  "* outerHTML": "html",
  "iframe srcdoc": "html",
  "script innerText": "script",
  "script src": "scriptURL",
  "script text": "script",
  "script textContent": "script",
  "embed src": "scriptURL",
  "object data": "scriptURL",
  "object codeBase": "scriptURL",
};

class TrustedTypePolicyFactory {
  #emptyHTML = new classes.html(internal);
  #emptyScript = new classes.script(internal);

  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  createPolicy(name: string, init: any = undefined) {
    need(arguments.length, 1);
    name = `${name}`;
    const options = {};
    for (const method of Object.values(methods)) {
      const given = idl.dictionary(init)[method];
      if (given != null) options[method] = idl.callable(given);
    }
    if (!scope.env.allowsTypePolicy(name, names.$has(name)) || (name === "default" && defaultPolicy)) {
      throw new TypeError(`Policy "${name}" disallowed.`);
    }
    const policy = new TrustedTypePolicy(internal, name, options);
    if (name === "default") [defaultPolicy, defaultOptions] = [policy, options];
    names.$add(name);
    return policy;
  }

  isHTML(value: unknown) {
    need(arguments.length, 1);
    return dataOf(value, "html") !== undefined;
  }
  isScript(value: unknown) {
    need(arguments.length, 1);
    return dataOf(value, "script") !== undefined;
  }
  isScriptURL(value: unknown) {
    need(arguments.length, 1);
    return dataOf(value, "scriptURL") !== undefined;
  }
  get emptyHTML() {
    return this.#emptyHTML;
  }
  get emptyScript() {
    return this.#emptyScript;
  }
  get defaultPolicy() {
    this.#emptyHTML;
    return defaultPolicy;
  }

  getAttributeType(tag: string, attribute: string, elementNs: any = "", ns: any = "") {
    need(arguments.length, 2);
    const sink = attributeSink(
      asciiLower(`${tag}`),
      `${elementNs ?? ""}` || HTML,
      asciiLower(`${attribute}`),
      `${ns ?? ""}` || null,
    );
    return sink ? classes[sink[0]].name : null;
  }

  getPropertyType(tag: string, property: string, elementNs: any = "") {
    need(arguments.length, 2);
    const isHtml = (`${elementNs ?? ""}` || HTML) === HTML;
    const kind =
      properties[`* ${property}`] ?? (isHtml ? properties[`${asciiLower(`${tag}`)} ${property}`] : undefined);
    return kind ? classes[kind].name : null;
  }
}
expose(TrustedTypePolicyFactory);

/** What the default policy makes of it, if anything. */
function byDefault(kind: Kind, text: string, sink: string): string | undefined {
  const result = defaultOptions?.[methods[kind]]?.(text, classes[kind].name, sink);
  return result == null ? undefined : convert(kind, result);
}

/** https://w3c.github.io/trusted-types/dist/spec/#get-trusted-type-compliant-string-algorithm */
function compliant(kind: Kind, value: unknown, sink: string, sample?: string): string {
  const data = dataOf(value, kind);
  if (data !== undefined) return data;
  const text = convert(kind, value);
  const converted = byDefault(kind, text, sink);
  if (converted !== undefined) return converted;
  if (scope.env.allowsStringFor(sink, sample ?? text)) return text;
  throw new TypeError(`This document requires '${classes[kind].name}' assignment.`);
}

/** `parts` are the arguments of a function constructor. */
function mayCompile(code: string, parts: unknown[] | undefined) {
  if (scope.env.allowsTrustedTypesEval() || parts?.every(part => dataOf(part, "script") !== undefined)) return true;
  try {
    const sample = parts && code.replace(/^(?:async )?function\*? anonymous/, "");
    return compliant("script", code, parts ? "Function" : "eval", sample) === code;
  } catch {
    return false;
  }
}

type Convert = (self: any, args: any[]) => void;

/** Puts `convert`, which may change the arguments, in front of a method or a setter. */
function guard(target: any, name: string, convert: Convert) {
  let holder = target;
  while (!Object.hasOwn(holder, name)) holder = Object.getPrototypeOf(holder);
  const member: any = Object.getOwnPropertyDescriptor(holder, name);
  const part = member.set ? "set" : "value";
  const original = member[part];
  const { guarded } = {
    guarded(...args: unknown[]) {
      if (args.length >= original.length) convert(this, args);
      return original.$apply(this, args);
    },
  };
  member[part] = Object.defineProperties(guarded, {
    name: { value: original.name },
    length: { value: original.length },
  });
  Object.defineProperty(target, name, member);
}

function attributeValue(element: any, name: string, ns: string | null, value: unknown) {
  const sink = attributeSink(element.localName, element.namespaceURI, name, ns);
  return sink ? compliant(sink[0], value, sink[1]) : value;
}

let isEnforced = false;

/** Until a document requires them, its sinks take no time to look for trusted types. */
function enforce() {
  if (isEnforced || !scope.isWindow) return;
  isEnforced = true;
  const { global } = scope;
  for (const [kind, sinks] of Object.entries({
    html: `DOMParser.parseFromString Element.innerHTML? Element.outerHTML? Element.setHTMLUnsafe HTMLIFrameElement.srcdoc
      Range.createContextualFragment ShadowRoot.innerHTML? ShadowRoot.setHTMLUnsafe`,
    scriptURL: "HTMLEmbedElement.src HTMLObjectElement.codeBase HTMLObjectElement.data HTMLScriptElement.src",
  })) {
    for (const sink of core.splitTokens(sinks)) {
      const [owner, name, takesNull] = sink.split(/[.?]/);
      guard(global[owner].prototype, name, (_, args) => {
        args[0] = compliant(kind as Kind, args[0] === null && takesNull === "" ? "" : args[0], `${owner} ${name}`);
      });
    }
  }
  guard(
    global.Document,
    "parseHTMLUnsafe",
    (_, args) => (args[0] = compliant("html", args[0], "Document parseHTMLUnsafe")),
  );
  guard(global.Element.prototype, "insertAdjacentHTML", (_, args) => {
    args[1] = compliant("html", args[1], "Element insertAdjacentHTML");
  });
  for (const name of ["write", "writeln"]) {
    guard(global.Document.prototype, name, (_, args) => {
      const texts = args.map(it => dataOf(it, "html") ?? `${it}`);
      if (args.every(it => dataOf(it, "html") !== undefined)) return void args.splice(0, Infinity, ...texts);
      const end = name === "write" ? "" : "\n";
      const text = compliant("html", texts.join("") + end, "Document " + name);
      args.splice(0, Infinity, text.endsWith(end) ? text.slice(0, text.length - end.length) : text);
    });
  }
  guard(global.Document.prototype, "execCommand", (_, args) => {
    if (asciiLower(`${args[0]}`) === "inserthtml") args[2] = compliant("html", args[2] ?? "", "Document execCommand");
  });
  for (const name of ["innerText", "text", "textContent"]) {
    guard(global.HTMLScriptElement.prototype, name, (script, args) => {
      const given = args[0] == null && name !== "text" && (args[0] === null || name === "textContent") ? "" : args[0];
      script.$impl.x.trustedText = args[0] = compliant("script", given, "HTMLScriptElement " + name);
    });
  }
  guard(global.Element.prototype, "setAttribute", (element, args) => {
    const isHtml = element.namespaceURI === HTML && element.$impl.doc.isHtml;
    const name = isHtml ? asciiLower(`${args[0]}`) : `${args[0]}`;
    const known = element.getAttributeNode(name);
    args[1] = attributeValue(element, known?.localName ?? name, known?.namespaceURI ?? null, args[1]);
  });
  guard(global.Element.prototype, "setAttributeNS", (element, args) => {
    args[2] = attributeValue(element, `${args[1]}`.split(":").at(-1)!, args[0] || null, args[2]);
  });
  const attach = (element: any, attr: any) => {
    if (!attr) return;
    const value = attributeValue(element, attr.localName, attr.namespaceURI, attr.value);
    if (attr.ownerElement === null) attr.value = value;
  };
  for (const suffix of ["", "NS"]) {
    guard(global.Element.prototype, "setAttributeNode" + suffix, (element, args) => attach(element, args[0]));
    guard(global.NamedNodeMap.prototype, "setNamedItem" + suffix, (map, args) =>
      attach(map[require("internal/desktop/web/dom").node.kList].node.js, args[0]),
    );
  }
  for (const name of ["nodeValue", "textContent", "value"]) {
    guard(global.Attr.prototype, name, (attr, args) => {
      const text = args[0] === null && name !== "value" ? "" : `${args[0]}`;
      if (attr.ownerElement) args[0] = attributeValue(attr.ownerElement, attr.localName, attr.namespaceURI, text);
    });
  }
}

export default {
  TrustedHTML: classes.html,
  TrustedScript: classes.script,
  TrustedScriptURL: classes.scriptURL,
  TrustedTypePolicy,
  TrustedTypePolicyFactory,
  compliant,
  enforce,
  mayCompile,
  trustedTypes: new TrustedTypePolicyFactory(internal),
};
