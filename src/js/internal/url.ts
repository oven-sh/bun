function urlToHttpOptions(url) {
  if (url === null || (typeof url !== "object" && typeof url !== "function")) {
    throw $ERR_INVALID_ARG_TYPE("url", "object", url);
  }
  const { hostname, pathname, port, username, password, search } = url;
  const options = {
    __proto__: null,
    ...url,
    protocol: url.protocol,
    hostname: typeof hostname === "string" && hostname.startsWith("[") ? hostname.slice(1, -1) : hostname,
    hash: url.hash,
    search: search,
    pathname: pathname,
    path: `${pathname || ""}${search || ""}`,
    href: url.href,
  };
  if (port !== "") {
    options.port = Number(port);
  }
  if (username || password) {
    options.auth = `${decodeURIComponent(username)}:${decodeURIComponent(password)}`;
  }
  return options;
}

export default {
  urlToHttpOptions,
};
