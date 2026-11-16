// The legacy encodings of documents.
const encodeText = $bindgen("desktop.bind.ts", "encodeText");

const names = { "big5": "Big5", "gb18030": "gb18030", "shift_jis": "Shift_JIS" };

/** https://encoding.spec.whatwg.org/#names-and-labels */
function nameOf(encoding: string): string {
  if (/^(?:windows-|x-|macintosh|replacement)/.test(encoding)) return encoding;
  return names[encoding] ?? encoding.toUpperCase();
}

const escape = (byte: number) => "%" + byte.toString(16).toUpperCase().padStart(2, "0");

/** https://url.spec.whatwg.org/#string-percent-encode-after-encoding */
function percentEncode(text: string, encoding: string, isForm: boolean): string {
  let out = "";
  for (const byte of encodeText(encoding, text.toWellFormed(), !isForm) as Uint8Array) {
    const unit = String.fromCharCode(byte);
    if (isForm) out += unit === " " ? "+" : /[\w*.-]/.test(unit) ? unit : escape(byte);
    else out += byte > 0x20 && byte < 0x7f && unit !== "#" ? unit : escape(byte);
  }
  return out;
}

/** https://html.spec.whatwg.org/#encoding-parsing-a-url */
function parseUrl(text: string, base: string, encoding: string): URL | null {
  const url = URL.parse(text, base);
  const query = /^[^?#]*\?([^#]*)/.exec(text.replace(/^[\0- ]+|[\0- ]+$|[\t\n\r]/g, ""))?.[1];
  if (url && query && /^(?:https?|ftp|file):$/.test(url.protocol))
    url.search = "?" + percentEncode(query, encoding, false);
  return url;
}

const withCrLf = (text: string) => text.replace(/\r\n?|\n/g, "\r\n");

function multipart(entries: Iterable<[string, any]>, encoding: string) {
  const boundary = "----WebKitFormBoundary" + crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const encode = (text: string) => encodeText(encoding, text.toWellFormed(), false);
  const quote = (text: string) => text.replace(/[\n\r"]/g, found => escape(found.charCodeAt(0)));
  const parts: unknown[] = [];
  for (const [name, value] of entries) {
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="${quote(withCrLf(name))}"`;
    if (typeof value === "string") parts.push(encode(`${head}\r\n\r\n${withCrLf(value)}`));
    else {
      const type = value.type || "application/octet-stream";
      parts.push(encode(`${head}; filename="${quote(value.name)}"\r\nContent-Type: ${type}\r\n\r\n`), value);
    }
    parts.push("\r\n");
  }
  return {
    body: new Blob([...parts, `--${boundary}--\r\n`] as any),
    contentType: "multipart/form-data; boundary=" + boundary,
  };
}

function pickEncoding(accepted: string | null, fallback: string): string {
  const { encodingOf } = require("internal/desktop/web/mime");
  const encoding = accepted === null ? fallback : (accepted.split(whitespace).map(encodingOf).find(Boolean) ?? "utf-8");
  return /^(?:utf-16|replacement)/.test(encoding) ? "utf-8" : encoding;
}
const whitespace = /[\t\n\f\r ]+/;

function encodingOfForm(accepted: string | null, fallback: string): string {
  const encoding = pickEncoding(accepted, fallback);
  return encoding === "utf-8" ? "UTF-8" : nameOf(encoding);
}

/** https://html.spec.whatwg.org/#form-submission-algorithm */
function encodeForm(entries: Iterable<[string, any]>, type: string, accepted: string | null, fallback: string) {
  const encoding = pickEncoding(accepted, fallback);
  if (type === "multipart/form-data") return multipart(entries, encoding);
  const pairs = Array.from(entries, ([name, value]) =>
    [name, typeof value === "string" ? value : value.name].map(withCrLf),
  );
  if (type === "text/plain") {
    const text = pairs.map(pair => pair.join("=") + "\r\n").join("");
    return { body: encodeText(encoding, text.toWellFormed(), false), contentType: type };
  }
  const text = pairs.map(pair => pair.map(it => percentEncode(it, encoding, true)).join("=")).join("&");
  return { text, body: Buffer.from(text), contentType: "application/x-www-form-urlencoded" };
}

export default { encodeForm, encodingOfForm, multipart, nameOf, parseUrl, percentEncode };
