// Mock de internal/url pour Bun-Elixir utilisant le type URL natif de JavaScript
const URL = globalThis.URL;
const URLSearchParams = globalThis.URLSearchParams;

function isURL(val) {
  return val != null && typeof val === 'object' && val.constructor !== undefined && val.constructor.name === 'URL';
}

function toPathIfFileURL(fileURLOrPath) {
  if (!isURL(fileURLOrPath)) {
    return fileURLOrPath;
  }
  if (fileURLOrPath.protocol !== 'file:') {
    throw new Error('must be a file URL');
  }
  return fileURLToPath(fileURLOrPath);
}

function fileURLToPath(url) {
  if (typeof url === 'string') {
    url = new URL(url);
  } else if (!isURL(url)) {
    throw new TypeError('must be a URL');
  }
  if (url.protocol !== 'file:') {
    throw new TypeError('must be a file URL');
  }
  let path = decodeURIComponent(url.pathname);
  if (process.platform === 'win32') {
    if (path.startsWith('/')) {
      path = path.slice(1);
    }
    path = path.replace(/\//g, '\\');
  }
  return path;
}

function pathToFileURL(filepath) {
  let resolved = filepath;
  if (process.platform === 'win32') {
    resolved = resolved.replace(/\\/g, '/');
    if (!resolved.startsWith('/')) {
      resolved = '/' + resolved;
    }
  }
  return new URL('file://' + resolved);
}

function urlToHttpOptions(url) {
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    hash: url.hash,
    search: url.search,
    pathname: url.pathname,
    path: url.pathname + url.search,
    href: url.href,
    port: url.port,
    auth: url.username || url.password ? `${url.username}:${url.password}` : undefined
  };
}

module.exports = {
  URL,
  URLSearchParams,
  isURL,
  toPathIfFileURL,
  fileURLToPath,
  pathToFileURL,
  urlToHttpOptions,
  URLParse: (url, base) => new URL(url, base),
  getURLOrigin: (url) => url.origin
};
