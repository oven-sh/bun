type DomainConversion = (domain: string) => string;
const [domainToASCII, domainToUnicode, idnaToASCII]: [DomainConversion, DomainConversion, DomainConversion] = $cpp(
  "NodeURL.cpp",
  "Bun::createNodeURLBinding",
);

interface HttpOptions {
  __proto__: null;
  protocol: string;
  hostname: string;
  hash: string;
  search: string;
  pathname: string;
  path: string;
  href: string;
  port?: number;
  auth?: string;
}

// Node's isURL (lib/internal/url.js). Legacy url.parse() objects set `auth` and `path`, so they don't match.
function isURL(self) {
  return Boolean(self?.href && self.protocol && self.auth === undefined && self.path === undefined);
}

function urlToHttpOptions(url: URL) {
  const options: HttpOptions = {
    __proto__: null,
    // Own properties only: the members of a URL are accessors of its prototype.
    ...(url as object),
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
  let password: string | undefined;
  if (username || (password = url.password)) {
    options.auth = `${decodeURIComponent(username)}:${decodeURIComponent(password ?? url.password)}`;
  }
  return options;
}

export default {
  domainToASCII,
  domainToUnicode,
  idnaToASCII,
  isURL,
  urlToHttpOptions,
};
