// Which proxy a request goes through.
const keywordsOfProtocols = { "http:": "PROXY", "https:": "HTTPS", "socks4:": "SOCKS" };
const defaultPorts = { PROXY: 80, HTTPS: 443 };

const fs = require("node:fs");
const path = require("node:path");
const { glob } = require("internal/desktop/electron/policy");

type Config = {
  mode: string;
  pacScript?: string;
  proxyRules?: string;
  proxyBypassRules?: string;
  isOptional?: boolean;
};
/** URLs of proxies, in the order in which to try them. `null` is no proxy. */
type Route = (string | null)[];

const DIRECT: Route = [null];
const SETTINGS_TTL = 60_000;
const SCRIPT_TTL = 2 * 60 * 60_000;
const then = <T, U>(value: T | Promise<T>, next: (value: T) => U) =>
  $isPromise(value) ? value.then(next) : next(value as T);

function bypasses(url: URL, rules = "") {
  const list = rules.split(/[\s,;]+/).filter(Boolean);
  const { hostname, host } = url;
  const isLoopback = /^(?:localhost|.*\.localhost|127(?:\.\d+){3}|169\.254(?:\.\d+){2}|\[::1\]|\[fe80:.*)$/.test(
    hostname,
  );
  if (isLoopback && !list.includes("<-loopback>")) return true;
  return list.some(rule => {
    if (rule === "<local>") return !/[.:]/.test(hostname);
    const [, scheme, pattern, bits] = /^(?:(\w+):\/\/)?(.*?)(?:\/(\d+))?$/.exec(rule.toLowerCase())!;
    if (scheme !== undefined && scheme + ":" !== url.protocol) return false;
    if (bits === undefined) return [hostname, host].some(it => glob(pattern.replace(/^\./, "*.")).test(it));
    const { BlockList, isIP } = require("node:net");
    const [address, network] = [hostname, pattern].map(it => it.replace(/^\[|\]$/g, ""));
    if (!isIP(address) || isIP(address) !== isIP(network) || +bits > (isIP(network) === 4 ? 32 : 128)) return false;
    const block = new BlockList();
    block.addSubnet(network, +bits, "ipv" + isIP(network));
    return block.check(address, "ipv" + isIP(address));
  });
}

function fromRules(url: URL, { proxyRules = "", proxyBypassRules }: Config): Route {
  if (bypasses(url, proxyBypassRules)) return DIRECT;
  const rules = new Map<string | undefined, string>();
  for (const rule of proxyRules.split(";")) {
    const [, scheme, proxies] = /^\s*(?:(\w+)=)?(.*?)\s*$/.exec(rule)!;
    if (proxies) rules.$set(scheme, proxies);
  }
  const wanted = { "http:": ["http", "socks"], "https:": ["https", "socks"] }[url.protocol] ?? [
    "socks",
    "https",
    "http",
  ];
  const scheme = [undefined, ...wanted].find(it => rules.$has(it));
  const complete = (it: string) => (it.includes("://") ? it : `${scheme === "socks" ? "socks4" : "http"}://${it}`);
  return (
    rules
      .$get(scheme)
      ?.split(",")
      .map(it => (it.trim() === "direct://" ? null : complete(it.trim()))) ?? DIRECT
  );
}

const keywords = {
  __proto__: null,
  PROXY: "http",
  HTTP: "http",
  HTTPS: "https",
  SOCKS: "socks4",
  SOCKS4: "socks4",
  SOCKS5: "socks5",
};

function fromAnswer(answer: string): Route {
  const route: Route = [];
  for (const part of answer.split(";")) {
    const [keyword, address] = part.trim().split(/\s+/);
    const scheme = keywords[keyword.toUpperCase()];
    if (keyword.toUpperCase() === "DIRECT") route.push(null);
    else if (scheme && URL.canParse(`${scheme}://${address}`)) route.push(`${scheme}://${address}`);
  }
  return route.length > 0 ? route : DIRECT;
}

function toAnswer(route: Route) {
  return route
    .map(proxy => {
      if (proxy === null) return "DIRECT";
      const { protocol, hostname, port } = new URL(proxy);
      const keyword = keywordsOfProtocols[protocol] ?? "SOCKS5";
      return `${keyword} ${hostname}:${port || (defaultPorts[keyword] ?? 1080)}`;
    })
    .join("; ");
}

function fromParts(parts: {
  http?: string;
  https?: string;
  socks?: string;
  bypass?: string;
  script?: string;
  detects?: boolean;
}): Config {
  const { http, https, socks, bypass, script, detects } = parts;
  if (script) return { mode: "pac_script", pacScript: script, isOptional: true };
  const proxyRules = [http && "http=" + http, https && "https=" + https, socks && "socks=" + socks]
    .filter(Boolean)
    .join(";");
  if (proxyRules) return { mode: "fixed_servers", proxyRules, proxyBypassRules: bypass };
  return { mode: detects ? "auto_detect" : "direct" };
}

async function output(...command: string[]) {
  const child = Bun.spawn({ cmd: command, stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 5000 });
  const text = await child.stdout.text();
  if ((await child.exited) !== 0) throw new Error(command[0] + " has failed");
  return text;
}
const lookUp = (text: string, separator: string) => (name: string) =>
  new RegExp(`^\\s*${name}${separator}(.*?)\\s*$`, "m").exec(text)?.[1] ?? "";
const address = (host: string, port: string) => (host && port !== "0" ? `${host}:${port || 80}` : undefined);

function fromEnvironment(): Config {
  const get = (name: string) => process.env[name] || process.env[name.toUpperCase()];
  const all = get("all_proxy");
  return fromParts({
    http: all ?? get("http_proxy"),
    https: all ?? get("https_proxy"),
    script: get("auto_proxy"),
    bypass: get("no_proxy")?.replace(/(^|[\s,])(?=[a-z\d])(?![\d.]+\/)/gi, "$1*"),
  });
}

async function fromGnome(): Promise<Config> {
  const text = await output("gsettings", "list-recursively", "org.gnome.system.proxy");
  const get = (name: string) =>
    lookUp(text, " ")("org.gnome.system.proxy" + name).replace(/^(?:@as )?\[?|[\x27\]]/g, "");
  const mode = get(" mode");
  if (mode === "auto") return fromParts({ script: get(" autoconfig-url"), detects: true });
  if (mode !== "manual") return { mode: "direct" };
  const [http, https, socks] = ["http", "https", "socks"].map(it => address(get(`.${it} host`), get(`.${it} port`)));
  return fromParts({ http, https, socks: socks && "socks5://" + socks, bypass: get(" ignore-hosts") });
}

function fromKde(): Config {
  const file = path.join(require("internal/desktop/app").app.getPath("appData"), "kioslaverc");
  const get = lookUp(fs.readFileSync(file, "utf8"), "(?:\\[.*?\\])?=");
  const type = get("ProxyType");
  if (type === "4") return fromEnvironment();
  if (type === "2" || type === "3")
    return fromParts({ script: type === "2" ? get("Proxy Config Script") : "", detects: true });
  if (type !== "1") return { mode: "direct" };
  const [http, https, socks] = ["http", "https", "socks"].map(it => get(it + "Proxy").replace(" ", ":"));
  return fromParts({ http, https, socks: socks.replace("socks://", "socks5://"), bypass: get("NoProxyFor") });
}

async function fromMac(): Promise<Config> {
  const text = await output("/usr/sbin/scutil", "--proxy");
  const get = lookUp(text, " : ");
  const [http, https, socks] = ["HTTP", "HTTPS", "SOCKS"].map(it =>
    get(it + "Enable") === "1" ? address(get(it + "Proxy"), get(it + "Port")) : undefined,
  );
  const exceptions = /ExceptionsList : <array> \{(.*?)\}/s.exec(text)?.[1].replace(/^\s*\d+ : /gm, "") ?? "";
  return fromParts({
    http,
    https,
    socks: socks && "socks5://" + socks,
    bypass: exceptions + (get("ExcludeSimpleHostnames") === "1" ? " <local>" : ""),
    script: get("ProxyAutoConfigEnable") === "1" ? get("ProxyAutoConfigURLString") : "",
    detects: get("ProxyAutoDiscoveryEnable") === "1",
  });
}

async function fromWindows(): Promise<Config> {
  const reg = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
  const text = await output(
    reg,
    "query",
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
    "/s",
  );
  const get = lookUp(text, "\\s+REG_\\w+\\s+");
  if (get("ProxyEnable") === "0x1" && !get("AutoConfigURL")) {
    return { mode: "fixed_servers", proxyRules: get("ProxyServer"), proxyBypassRules: get("ProxyOverride") };
  }
  const flags = parseInt(get("DefaultConnectionSettings").slice(16, 18), 16);
  return fromParts({ script: get("AutoConfigURL"), detects: (flags & 8) !== 0 });
}

function readSystem(): Config | Promise<Config> {
  const desktop = process.env.XDG_CURRENT_DESKTOP ?? "";
  const read =
    { darwin: fromMac, win32: fromWindows }[process.platform as string] ??
    (desktop.includes("KDE") ? fromKde : /gnome|unity|cinnamon|pantheon|deepin|ukui/i.test(desktop) && fromGnome);
  return read ? Promise.try(read).catch(fromEnvironment) : fromEnvironment();
}

/** What has been read stays in use while it is read again. */
class Cached<T> {
  #value: T | Promise<T> | undefined;
  #expires = 0;

  constructor(
    readonly read: () => T | Promise<T>,
    readonly lifetime: number,
  ) {}

  get(): T | Promise<T> {
    const now = performance.now();
    if (now < this.#expires) return this.#value!;
    this.#expires = now + this.lifetime;
    const reading = then(this.read(), value => (this.#value = value));
    if ($isPromise(reading)) {
      reading.catch(() => {
        if (this.#value === reading) this.clear();
      });
    }
    return (this.#value ??= reading);
  }

  clear() {
    this.#value = undefined;
    this.#expires = 0;
  }
}

const lookUpHost = (host: string): Promise<string[]> =>
  require("node:dns")
    .promises.lookup(host, { all: true })
    .then(
      found => found.map(it => it.address),
      () => [],
    );

async function readScript(url: string) {
  const response = await fetch(url, { proxy: false, signal: AbortSignal.timeout(30_000) });
  if (!response.ok || +response.headers.get("content-length")! > 1 << 22) throw new Error("No script at " + url);
  return require("internal/desktop/electron/pac").load(await response.text(), lookUpHost);
}

async function detectScript() {
  try {
    if ((await Promise.race([lookUpHost("wpad"), Bun.sleep(1000)]))?.length)
      return await readScript("http://wpad/wpad.dat");
  } catch {}
  return () => "DIRECT";
}

const system = new Cached(readSystem, SETTINGS_TTL);
const scripts = new Map<string, Cached<Function>>();

function fromScript(url: URL, { pacScript = "", isOptional }: Config): Route | Promise<Route> {
  if (bypasses(url)) return DIRECT;
  let script = scripts.$get(pacScript);
  if (!script) {
    const read = pacScript ? () => readScript(pacScript) : detectScript;
    scripts.$set(pacScript, (script = new Cached(read, pacScript ? SCRIPT_TTL : SETTINGS_TTL * 5)));
  }
  const shown = /^(?:https|wss):$/.test(url.protocol) ? url.origin + "/" : url.origin + url.pathname + url.search;
  const failed = (error: unknown) => {
    if (isOptional || !pacScript) return DIRECT;
    throw require("internal/desktop/electron/loader").netError("MANDATORY_PROXY_CONFIGURATION_FAILED", error);
  };
  try {
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const route = then(script.get(), find => then<string, Route>(find(shown.replace(/^ws/, "http"), host), fromAnswer));
    return $isPromise(route) ? (route.catch(failed) as any) : route;
  } catch (error) {
    return failed(error);
  }
}

function resolve(url: URL, config: Config): Route | Promise<Route> {
  switch (config.mode) {
    case "direct":
      return DIRECT;
    case "fixed_servers":
      return fromRules(url, config);
    case "system":
      return then(system.get(), found => resolve(url, found)) as Route;
  }
  return fromScript(url, config);
}

function normalize(config: any): Config {
  const { pacScript, proxyRules, proxyBypassRules } = config;
  const mode = config.mode ?? (pacScript ? "pac_script" : proxyRules ? "fixed_servers" : "direct");
  if (!/^(?:direct|auto_detect|pac_script|fixed_servers|system)$/.test(mode)) {
    throw new Error("Invalid mode, must be one of direct, auto_detect, pac_script, fixed_servers or system");
  }
  return { mode, pacScript: mode === "pac_script" ? pacScript : undefined, proxyRules, proxyBypassRules };
}

function fromSwitches(switches: Map<string, string>): Config {
  if (switches.$has("no-proxy-server")) return { mode: "direct" };
  if (switches.$get("proxy-pac-url")) return { mode: "pac_script", pacScript: switches.$get("proxy-pac-url") };
  if (switches.$has("proxy-auto-detect")) return { mode: "auto_detect" };
  if (!switches.$get("proxy-server")) return { mode: "system" };
  const [proxyRules, proxyBypassRules] = [switches.$get("proxy-server"), switches.$get("proxy-bypass-list")];
  return { mode: "fixed_servers", proxyRules, proxyBypassRules };
}

function reload() {
  system.clear();
  scripts.$clear();
}

export default { fromSwitches, normalize, reload, resolve, toAnswer };
