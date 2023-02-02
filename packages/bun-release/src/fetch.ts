import { debug, isDebug } from "./console";

export const fetch = "fetch" in globalThis ? webFetch : nodeFetch;

type Options = RequestInit & { assert?: boolean };

async function webFetch(url: string, options: Options = {}): Promise<Response> {
  debug("fetch request", url, options);
  const response = await globalThis.fetch(url, options, { verbose: isDebug });
  debug("fetch response", response);
  if (options?.assert !== false && !isOk(response.status)) {
    try {
      debug(await response.text());
    } catch {}
    throw new Error(`${response.status}: ${url}`);
  }
  return response;
}

async function nodeFetch(url: string, options: Options = {}): Promise<Response> {
  const { get } = await import("node:http");
  return new Promise((resolve, reject) => {
    get(url, response => {
      debug("http.get", url, response.statusCode);
      const status = response.statusCode ?? 501;
      if (response.headers.location && isRedirect(status)) {
        return nodeFetch(url).then(resolve, reject);
      }
      if (options?.assert !== false && !isOk(status)) {
        return reject(new Error(`${status}: ${url}`));
      }
      const body: Buffer[] = [];
      response.on("data", chunk => {
        body.push(chunk);
      });
      response.on("end", () => {
        resolve({
          ok: isOk(status),
          status,
          async arrayBuffer() {
            return Buffer.concat(body).buffer as ArrayBuffer;
          },
          async text() {
            return Buffer.concat(body).toString("utf-8");
          },
          async json() {
            const text = Buffer.concat(body).toString("utf-8");
            return JSON.parse(text);
          },
        } as Response);
      });
    }).on("error", reject);
  });
}

function isOk(status: number): boolean {
  return status >= 200 && status <= 204;
}

function isRedirect(status: number): boolean {
  switch (status) {
    case 301: // Moved Permanently
    case 308: // Permanent Redirect
    case 302: // Found
    case 307: // Temporary Redirect
    case 303: // See Other
      return true;
  }
  return false;
}
