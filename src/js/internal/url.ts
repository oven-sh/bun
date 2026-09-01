// Node's isURL (lib/internal/url.js): a duck-type check rather than
// `instanceof`, so a URL instance still counts after globalThis.URL was
// replaced (happy-dom's global registrator does that), and so do compatible
// foreign implementations; `auth`/`path` must be absent to exclude legacy
// `url.parse` objects, which carry both.
function isURL(self) {
  return Boolean(self?.href && self.protocol && self.auth === undefined && self.path === undefined);
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
  isURL,
  urlToHttpOptions,
};
