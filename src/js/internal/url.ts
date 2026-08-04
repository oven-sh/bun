function urlToHttpOptions(url) {
  // Node's validateObject(url, "url", kValidateObjectAllowObjects): arrays and
  // functions are accepted, null and primitives are not.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/url.js#L1448
  if (url === null || (typeof url !== "object" && typeof url !== "function")) {
    throw $ERR_INVALID_ARG_TYPE("url", "object", url);
  }
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
};
