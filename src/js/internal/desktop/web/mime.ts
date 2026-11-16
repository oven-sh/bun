// MIME types and the grammar of header values, for both sides of a page.
type Mime = { essence: string; parameters: Map<string, string> };

const quote = '"';
const needsEscape = /[\\"]/g;
const token = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const isToken = (text: string) => token.test(text);
const trim = (text: string) => text.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");

/** `at` is where the opening quote is. Returns the value, and where the rest begins. */
function quoted(text: string, at: number): [string, number] {
  let value = "";
  for (at++; at < text.length; at++) {
    if (text[at] === '"') return [value, at + 1];
    if (text[at] === "\\" && ++at === text.length) return [value + "\\", at];
    value += text[at];
  }
  return [value, at];
}

function parse(text: string): Mime | undefined {
  text = trim(text);
  const slash = text.indexOf("/");
  let at = text.indexOf(";");
  if (at < 0) at = text.length;
  const type = text.slice(0, slash);
  const subtype = text.slice(slash + 1, at).replace(/[\t\n\r ]+$/, "");
  if (slash < 0 || slash > at || !isToken(type) || !isToken(subtype)) return;
  const parameters = new Map<string, string>();
  const until = (stop: string) => {
    const start = at;
    while (at < text.length && !stop.includes(text[at])) at++;
    return text.slice(start, at);
  };
  while (at < text.length) {
    at++;
    while (at < text.length && "\t\n\r ".includes(text[at])) at++;
    const name = until(";=").replace(/[A-Z]+/g, it => it.toLowerCase());
    if (text[at] === ";") continue;
    if (++at >= text.length) break;
    let value: string;
    if (text[at] === '"') {
      [value, at] = quoted(text, at);
      until(";");
    } else if ((value = until(";").replace(/[\t\n\r ]+$/, "")) === "") continue;
    if (isToken(name) && /^[\t -~\x80-\xff]*$/.test(value) && !parameters.$has(name)) parameters.$set(name, value);
  }
  return { essence: `${type}/${subtype}`.toLowerCase(), parameters };
}

function serialize({ essence, parameters }: Mime): string {
  let text = essence;
  for (const [name, value] of parameters) {
    text += `;${name}=` + (isToken(value) ? value : quote + value.replace(needsEscape, "\\$&") + quote);
  }
  return text;
}

/** At the commas that are not in quotes. */
function split(text: string, separator = ","): string[] {
  const values: string[] = [];
  let start = 0;
  for (let at = 0; at <= text.length;) {
    if (text[at] === '"') at = quoted(text, at)[1];
    else if (at === text.length || text[at] === separator) {
      values.push(text.slice(start, at).replace(/^[\t ]+|[\t ]+$/g, ""));
      start = ++at;
    } else at++;
  }
  return values;
}

/** From the value of `Content-Type`. */
function extract(header: string | null | undefined): Mime | undefined {
  let charset: string | undefined;
  let found: Mime | undefined;
  for (const value of header == null ? [] : split(header)) {
    const mime = parse(value);
    if (!mime || mime.essence === "*/*") continue;
    if (mime.essence !== found?.essence) charset = mime.parameters.$get("charset");
    else if (charset !== undefined && !mime.parameters.$has("charset")) mime.parameters.$set("charset", charset);
    found = mime;
  }
  return found;
}

const isJavaScript = (essence: string) =>
  /^(?:(?:application|text)\/(?:x-)?(?:ecma|java)script|text\/(?:javascript1\.[0-5]|jscript|livescript))$/.test(
    essence,
  );
const isXml = (essence: string) => /^(?:text|application)\/xml$|\+xml$/.test(essence);
const isJson = (essence: string) => /^(?:text|application)\/json$|\+json$/.test(essence);

const hasUnsafeByte = (value: string) => /[\0-\x08\n-\x1f"():<>?@[\\\]{}\x7f]/.test(value);

/** `name` is in lower case. */
function isSafelisted(name: string, value: string): boolean {
  if (value.length > 128) return false;
  switch (name) {
    case "accept":
      return !hasUnsafeByte(value);
    case "accept-language":
    case "content-language":
      return /^[0-9A-Za-z *,.;=-]*$/.test(value);
    case "content-type":
      return (
        !hasUnsafeByte(value) &&
        /^(?:application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)$/.test(parse(value)?.essence ?? "")
      );
    case "range": {
      const range = /^bytes=(\d+)-(\d*)$/.exec(value);
      return range !== null && (range[2] === "" || BigInt(range[1]) <= BigInt(range[2]));
    }
  }
  return false;
}

const isForbiddenMethod = (method: string) => /^(?:connect|trace|track)$/i.test(method);

function isForbiddenHeader(name: string, value: string): boolean {
  if (/^x-(?:http-method|http-method-override|method-override)$/.test(name))
    return split(value).some(isForbiddenMethod);
  return /^(?:accept-charset|accept-encoding|access-control-request-(?:headers|method|private-network)|connection|content-length|cookie2?|date|dnt|expect|host|keep-alive|origin|referer|set-cookie|te|trailer|transfer-encoding|upgrade|user-agent|via|proxy-.*|sec-.*)$/.test(
    name,
  );
}

const normalizeMethod = (method: string) =>
  /^(?:delete|get|head|options|post|put)$/i.test(method) ? method.toUpperCase() : method;

/** The name that `TextDecoder` has for it. */
function encodingOf(label: string | undefined): string | undefined {
  if (label === undefined) return;
  if (/^[\t\n\f\r ]*(?:csiso2022kr|hz-gb-2312|iso-2022-(?:cn|cn-ext|kr)|replacement)[\t\n\f\r ]*$/i.test(label))
    return "replacement";
  try {
    return new TextDecoder(label).encoding;
  } catch {}
}

function sniffBom(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
}

const headTags = /^(?:base|link|meta|noscript|object|script|style|title)$/;
const rawTextTags = /^(?:iframe|noembed|noframes|script|style|textarea|title|xmp)$/;
const numericReference = /&#(?:x([\da-f]{1,4})|(\d{1,4}));?/gi;
const charsetInContent = /charset[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r ;"'][^\t\n\f\r ;]*))/i;

function encodingOfMeta(found: Record<string, string>): string | undefined {
  const isPragma = found["http-equiv"]?.toLowerCase() === "content-type";
  const label =
    found.charset ??
    (isPragma
      ? charsetInContent
          .exec(found.content ?? "")
          ?.slice(1)
          .find(Boolean)
      : undefined);
  const encoding = encodingOf(
    label?.replace(numericReference, (_, hex, decimal) => String.fromCharCode(hex ? parseInt(hex, 16) : +decimal)),
  );
  return encoding?.startsWith("utf-16") ? "utf-8" : encoding === "x-user-defined" ? "windows-1252" : encoding;
}

/** The `<meta>` that the parser would change the encoding for: in the first kilobyte, or in the head. */
function prescan(bytes: Uint8Array): string | undefined {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).latin1Slice();
  if (text.startsWith("<\0?\0x\0")) return "utf-16le";
  if (text.startsWith("\0<\0?\0x")) return "utf-16be";
  const tag = /<([/]?)([a-z][^\t\n\f\r >/]*)/iy;
  const attribute =
    /[\t\n\f\r /]*([^\t\n\f\r />][^\t\n\f\r /=>]*)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"([^"]*)"|'([^']*)'|([^\t\n\f\r >]*)))?/y;
  let isInHead = true;
  for (let at = 0; (at = text.indexOf("<", at)) >= 0 && (isInHead || at < 1024);) {
    tag.lastIndex = at;
    const match = tag.exec(text);
    if (match === null) {
      if (text.startsWith("<!--", at)) at = text.indexOf("--" + ">", at + 2);
      else if ("!/?".includes(text[at + 1])) at = text.indexOf(">", at);
      if (at++ < 0) break;
      continue;
    }
    const found: Record<string, string> = { __proto__: null as any };
    at = attribute.lastIndex = tag.lastIndex;
    for (let it; (it = attribute.exec(text)) !== null; at = attribute.lastIndex)
      found[it[1].toLowerCase()] ??= it[2] ?? it[3] ?? it[4] ?? "";
    if ((at = text.indexOf(">", at)) < 0) break;
    const [isEnd, name] = [match[1] !== "", match[2].toLowerCase()];
    if (!headTags.test(name) && (isEnd || (name !== "html" && name !== "head"))) isInHead = false;
    if (isEnd) continue;
    const encoding = name === "meta" ? encodingOfMeta(found) : undefined;
    if (encoding) return encoding;
    if (name === "plaintext") break;
    if (!rawTextTags.test(name)) continue;
    const end = new RegExp(`</${name}[\\t\\n\\f\\r />]`, "gi");
    end.lastIndex = at;
    if ((at = end.exec(text)?.index ?? -1) < 0) break;
  }
  return declaredInXml(bytes);
}

function declaredInXml(bytes: Uint8Array): string | undefined {
  const start = Buffer.from(bytes.subarray(0, 1024)).latin1Slice();
  const encoding = encodingOf(/^<\?xml[^>]*?encoding[\0- ]*=[\0- ]*(["'])([^\0- >]*?)\1/.exec(start)?.[2]);
  return encoding?.startsWith("utf-16") ? "utf-8" : encoding;
}

/** https://mimesniff.spec.whatwg.org/#minimize-a-supported-mime-type */
function minimize(essence = ""): string {
  if (isJavaScript(essence)) return "text/javascript";
  if (isJson(essence)) return "application/json";
  if (essence !== "image/svg+xml" && isXml(essence)) return "application/xml";
  return /^(?:audio|font|image|text|video)[/]|^application[/](?:pdf|wasm)$/.test(essence) ? essence : "";
}

/** A byte order mark overrides `fallback`. */
function decode(bytes: Uint8Array, fallback = "utf-8", isPartial = false): string {
  const encoding = sniffBom(bytes) ?? fallback;
  if (encoding === "replacement") return bytes.length > 0 ? "\ufffd" : "";
  return new TextDecoder(encoding).decode(bytes, { stream: isPartial });
}

const windowFeature = /([^\t\n\f\r =,]+)(?:[\t\n\f\r ]*=[\t\n\f\r =]*([^\t\n\f\r =,]*))?/g;
const positions = { screenx: "left", screeny: "top", innerwidth: "width", innerheight: "height" };

/** https://html.spec.whatwg.org/#concept-window-open-features-tokenize */
function windowFeatures(features: string) {
  const found = new Map<string, string>();
  for (const [, name, value = ""] of features.toLowerCase().matchAll(windowFeature)) {
    found.$set(Object.hasOwn(positions, name) ? positions[name] : name, value);
  }
  const isSet = (name: string, otherwise = false) => {
    const value = found.$get(name);
    return value === undefined
      ? otherwise
      : value === "" || value === "yes" || value === "true" || !!parseInt(value, 10);
  };
  const noreferrer = isSet("noreferrer");
  const noopener = noreferrer || isSet("noopener");
  found.$delete("noopener");
  found.$delete("noreferrer");
  const isTab =
    (isSet("location") || isSet("toolbar")) &&
    isSet("menubar") &&
    isSet("resizable", true) &&
    isSet("scrollbars") &&
    isSet("status");
  const isPopup = found.$size > 0 && (found.$has("popup") ? isSet("popup") : !isTab);
  const number = (name: string) => parseInt(found.$get(name)!, 10) || undefined;
  return {
    noopener,
    noreferrer,
    isPopup,
    left: number("left"),
    top: number("top"),
    width: number("width"),
    height: number("height"),
  };
}

export default {
  windowFeatures,
  declaredInXml,
  decode,
  encodingOf,
  extract,
  isForbiddenHeader,
  isForbiddenMethod,
  isJavaScript,
  isJson,
  isSafelisted,
  isToken,
  isXml,
  minimize,
  normalizeMethod,
  parse,
  prescan,
  serialize,
  sniffBom,
  split,
  trim,
};
