const { URL } = globalThis;
const BunFileURLToPath = Bun.fileURLToPath;
const [domainToASCII, domainToUnicode] = $cpp("NodeURL.cpp", "Bun::createNodeURLBinding");

// Node's `isURL`: any object with truthy href and protocol that is not a
// legacy `url.parse()` result (those carry `auth` and `path`).
function isURL(self) {
  return Boolean(self != null && self.href && self.protocol && self.auth === undefined && self.path === undefined);
}

function getPathFromURLPosix(url) {
  if (url.hostname !== "") {
    throw $ERR_INVALID_FILE_URL_HOST(`File URL host must be "localhost" or empty on ${process.platform}`);
  }
  const pathname = url.pathname;
  for (let n = 0; n < pathname.length; n++) {
    if (pathname.$charCodeAt(n) === 37 /* % */) {
      const third = pathname.$charCodeAt(n + 2) | 0x20;
      if (pathname.$charCodeAt(n + 1) === 50 /* 2 */ && third === 102 /* f */) {
        throw $ERR_INVALID_FILE_URL_PATH("File URL path must not include encoded / characters");
      }
    }
  }
  return pathname.indexOf("%") === -1 ? pathname : decodeURIComponent(pathname);
}

function getPathFromURLWin32(url) {
  const hostname = url.hostname;
  let pathname = url.pathname;
  for (let n = 0; n < pathname.length; n++) {
    if (pathname.$charCodeAt(n) === 37 /* % */) {
      const third = pathname.$charCodeAt(n + 2) | 0x20;
      if (
        (pathname.$charCodeAt(n + 1) === 50 /* 2 */ && third === 102) /* f */ ||
        (pathname.$charCodeAt(n + 1) === 53 /* 5 */ && third === 99) /* c */
      ) {
        throw $ERR_INVALID_FILE_URL_PATH("File URL path must not include encoded \\ or / characters");
      }
    }
  }
  pathname = pathname.replace(/\//g, "\\");
  if (pathname.indexOf("%") !== -1) pathname = decodeURIComponent(pathname);
  if (hostname !== "") {
    return `\\\\${domainToUnicode(hostname)}${pathname}`;
  }
  const letter = pathname.$charCodeAt(1) | 0x20;
  if (letter < 97 /* a */ || letter > 122 /* z */ || pathname.$charCodeAt(2) !== 58 /* : */) {
    throw $ERR_INVALID_FILE_URL_PATH("File URL path must be absolute");
  }
  return pathname.slice(1);
}

function fileURLToPath(path, options?: { windows?: boolean }) {
  if (typeof path === "string" || ($isObject(path) && path instanceof URL)) {
    return BunFileURLToPath(path, options);
  }
  if (!isURL(path)) {
    throw $ERR_INVALID_ARG_TYPE("path", ["string", "URL"], path);
  }
  if (path.protocol !== "file:") {
    throw $ERR_INVALID_URL_SCHEME("The URL must be of scheme file");
  }
  return (options?.windows ?? process.platform === "win32") ? getPathFromURLWin32(path) : getPathFromURLPosix(path);
}

function toPathIfFileURL(fileURLOrPath) {
  if (!isURL(fileURLOrPath)) return fileURLOrPath;
  return fileURLToPath(fileURLOrPath);
}

function urlToHttpOptions(url) {
  const options = {
    ...url,
    protocol: url.protocol,
    hostname:
      typeof url.hostname === "string" && url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
    hash: url.hash,
    search: url.search,
    pathname: url.pathname,
    path: `${url.pathname || ""}${url.search || ""}`,
    href: url.href,
  };
  const port = url.port;
  if (port !== "") {
    options.port = Number(port);
  }
  const username = url.username;
  let password;
  if (username || (password = url.password)) {
    options.auth = `${decodeURIComponent(username)}:${decodeURIComponent(password ?? url.password)}`;
  }
  return options;
}

export default {
  urlToHttpOptions,
  isURL,
  fileURLToPath,
  toPathIfFileURL,
  domainToASCII,
  domainToUnicode,
};
