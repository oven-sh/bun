const [domainToASCII, domainToUnicode, idnaToASCII] = $cpp("NodeURL.cpp", "Bun::createNodeURLBinding");

function urlToHttpOptions(url) {
  if (!(url instanceof URL)) return urlToHttpOptionsOfAnything(url);
  // A URL's accessors are native and make a string at each read: each is read once.
  const hostname = url.hostname;
  const search = url.search;
  const pathname = url.pathname;
  const options: Record<string, unknown> = {
    __proto__: null,
    ...url,
    protocol: url.protocol,
    hostname: hostname.startsWith("[") ? hostname.slice(1, -1) : hostname,
    hash: url.hash,
    search,
    pathname,
    path: `${pathname || ""}${search || ""}`,
    href: url.href,
  };
  const port = url.port;
  if (port !== "") {
    options.port = Number(port);
  }
  const username = url.username;
  const password = url.password;
  if (username || password) {
    options.auth = `${decodeURIComponent(username)}:${decodeURIComponent(password)}`;
  }
  return options;
}

function urlToHttpOptionsOfAnything(url) {
  const options = {
    __proto__: null,
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
  domainToASCII,
  domainToUnicode,
  idnaToASCII,
  urlToHttpOptions,
};
