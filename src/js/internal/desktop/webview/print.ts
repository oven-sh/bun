// What `window.print()` does: the web engine lays a copy of the document out on pages, which are downloaded.
const engine = require("internal/desktop/webview/engine");
const policy = require("internal/desktop/electron/policy");
const sessions = require("internal/desktop/electron/session");

/** Stands for the origin of the document. */
const HOME = "https://print.invalid";
const [DOCUMENT, BLOB] = [HOME + "/.document", HOME + "/.blob/"];
const POLICY = "default-src 'none'; img-src * data:; font-src * data:; style-src * 'unsafe-inline'; base-uri *";
const blobUrl = new RegExp("blob:[^\\s\"'()<>]+", "g");
const notInNames = new RegExp('[\\x00-\\x1f/\\\\:*?"<>|]+', "g");

async function toPdf(page: any, baseUrl: string, markup: string): Promise<Uint8Array> {
  const blobs: unknown[] = [];
  const origin = policy.originOf(baseUrl);
  markup = markup.replace(blobUrl, url => BLOB + (blobs.push(policy.resolveBlob(url)) - 1));
  markup = `<!doctype html><meta charset=utf-8><base href="${Bun.escapeHTML(baseUrl)}">${markup}`.replaceAll(
    origin + "/",
    HOME + "/",
  );
  const session = sessions.fromPartition("print");
  const answer = async ({ url, headers }: Request) => {
    if (url === DOCUMENT)
      return new Response(markup, { headers: { "content-type": "text/html", "content-security-policy": POLICY } });
    if (url.startsWith(BLOB)) return new Response(blobs[url.slice(BLOB.length)]);
    if (url.startsWith(HOME + "/")) url = origin + url.slice(HOME.length);
    const accepts = headers.get("accept") ?? "";
    const destination = accepts.startsWith("text/css") ? "style" : accepts.startsWith("image/") ? "image" : "font";
    const { bytes, mime } = await page.fetchResource(url, destination);
    return new Response(bytes, { headers: { "content-type": mime, "access-control-allow-origin": "*" } });
  };
  for (const scheme of ["http", "https"]) session.protocol.handle(scheme, answer);
  const contents = new (require("internal/desktop/electron/web_contents").WebContents)(
    { session, javascript: false },
    "print",
  );
  try {
    await contents.loadURL(DOCUMENT);
    return await contents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  } finally {
    contents.destroy();
    for (const scheme of ["http", "https"]) session.protocol.unhandle(scheme);
  }
}

let isPrinting = false;

async function print(page: any, baseUrl: string, markup: string) {
  if (isPrinting || !engine.isAvailable()) return;
  isPrinting = true;
  try {
    const name = (page.webContents.getTitle().replace(notInNames, " ").trim() || "Untitled") + ".pdf";
    const pdf = await toPdf(page, baseUrl, markup);
    const { session } = page.webContents;
    const loaded = { url: page.url, headers: [["content-type", "application/pdf"]], response: new Response(pdf) };
    await sessions.DownloadItem.start(session, loaded, new AbortController(), page.webContents, name);
  } catch (error: any) {
    page.log("error", `Failed to print: ${error?.message}`);
  } finally {
    isPrinting = false;
  }
}

export default { print };
