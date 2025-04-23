// Define an interface for the HTTP options
interface HttpOptions {
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

function urlToHttpOptions(url) {
  // Cast the options object to our HttpOptions interface
  const options: HttpOptions = {
    protocol: url.protocol,
    hostname:
      typeof url.hostname === "string" && url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname,
    hash: url.hash,
    search: url.search,
    pathname: url.pathname,
    path: `${url.pathname || ""}${url.search || ""}`,
    href: url.href,
  };
  if (url.port !== "") {
    options.port = Number(url.port);
  }
  if (url.username || url.password) {
    options.auth = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
  }
  return options;
}

export default {
  urlToHttpOptions,
};
