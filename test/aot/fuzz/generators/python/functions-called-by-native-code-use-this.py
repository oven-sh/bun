#!/usr/bin/env python3
"""functions-called-by-native-code-use-this.py <seed>: a function of the program that native code or a built-in calls does one thing through `this`: it reads, stores, deletes, calls a method, tests `in` or asks
for the type. The seed picks who calls it (a handler of Bun.listen, Bun.connect, Bun.serve or Bun.udpSocket, a timer, a listener, a callback of a node: module, of a stream, of an array method with and without
a thisArg, call, apply, bind ..), what it does, how it is written (method, function, async, arrow, class method, generator) and whether the code is strict. An object that holds the function has a `mark` and a
`tell` of its own, so the answer shows whether `this` was that object."""
import json, re, sys

seed = int(sys.argv[1])
tls = {
    "cert": "-----BEGIN CERTIFICATE-----\nMIID4jCCAsqgAwIBAgIUcaRq6J/YF++Bo01Zc+HeQvCbnWMwDQYJKoZIhvcNAQEL\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE\nAwwKc2VydmVyLWJ1bjAeFw0yNTA5MDYwMzAwNDlaFw0zNTA5MDQwMzAwNDlaMGkx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\nbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl\ncnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDlYzosgRgX\nHL6vMh1V0ERFhsvlZrtRojSw6tafr3SQBphU793/rGiYZlL/lJ9HIlLkx9JMbuTj\nNm5U2eRwHiTQIeWD4aCIESwPlkdaVYtC+IOj55bJN8xNa7h5GyJwF7PnPetAsKyE\n8DMBn1gKMhaIis7HHOUtk4/K3Y4peU44d04z0yPt6JtY5Sbvi1E7pGX6T/2c9sHs\ndIDeDctWnewpXXs8zkAla0KNWQfpDnpS53wxAfStTA4lSrA9daxC7hZopQlLxFIb\nJk+0BLbEsXtrJ54T5iguHk+2MDVAy4MOqP9XbKV7eGHk73l6+CSwmHyHBxh4ChxR\nQeT5BP0MUTn1AgMBAAGjgYEwfzAdBgNVHQ4EFgQUw7nEnh4uOdZVZUapQzdAUaVa\nAn0wHwYDVR0jBBgwFoAUw7nEnh4uOdZVZUapQzdAUaVaAn0wDwYDVR0TAQH/BAUw\nAwEB/zAsBgNVHREEJTAjgglsb2NhbGhvc3SHBH8AAAGHEAAAAAAAAAAAAAAAAAAA\nAAEwDQYJKoZIhvcNAQELBQADggEBAEA8r1fvDLMSCb8bkAURpFk8chn8pl5MChzT\nYUDaLdCCBjPXJkSXNdyuwS+T/ljAGyZbW5xuDccCNKltawO4CbyEXUEZbYr3w9eq\nj8uqymJPhFf0O1rKOI2han5GBCgHwG13QwKI+4uu7390nD+TlzLOhxFfvOG7OadH\nQNMNLNyldgF4Nb8vWdz0FtQiGUIrO7iq4LFhhd1lCxe0q+FAYSEYcc74WtF/Yo8V\nJQauXuXyoP5FqLzNt/yeNQhceyIXJGKCsjr5/bASBmVlCwgRfsD3jpG37L8YCJs1\nL4WEikcY4Lzb2NF9e94IyZdQsRqd9DFBF5zP013MSUiuhiow32k=\n-----END CERTIFICATE-----\n",
    "key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDlYzosgRgXHL6v\nMh1V0ERFhsvlZrtRojSw6tafr3SQBphU793/rGiYZlL/lJ9HIlLkx9JMbuTjNm5U\n2eRwHiTQIeWD4aCIESwPlkdaVYtC+IOj55bJN8xNa7h5GyJwF7PnPetAsKyE8DMB\nn1gKMhaIis7HHOUtk4/K3Y4peU44d04z0yPt6JtY5Sbvi1E7pGX6T/2c9sHsdIDe\nDctWnewpXXs8zkAla0KNWQfpDnpS53wxAfStTA4lSrA9daxC7hZopQlLxFIbJk+0\nBLbEsXtrJ54T5iguHk+2MDVAy4MOqP9XbKV7eGHk73l6+CSwmHyHBxh4ChxRQeT5\nBP0MUTn1AgMBAAECggEABtPvC5uVGr0DjQX2GxONsK8cOxoVec7U+C4pUMwBcXcM\nyjxwlHdujpi/IDXtjsm+A2rSPu2vGPdKDfMFanPvPxW/Ne99noc6U0VzHsR8lnP8\nwSB328nyJhzOeyZcXk9KTtgIPF7156gZsJLsZTNL+ej90i3xQWvKxCxXmrLuad5O\nz/TrgZkC6wC3fgj1d3e8bMljQ7tLxbshJMYVI5o6RFTxy84DLI+rlvPkf7XbiMPf\n2lsm4jcJKvfx+164HZJ9QVlx8ncqOHAnGvxb2xHHfqv4JAbz615t7yRvtaw4Paj5\n6kQSf0VWnsVzgxNJWvnUZym/i/Qf5nQafjChCyKOEQKBgQD9f4SkvJrp/mFKWLHd\nkDvRpSIIltfJsa5KShn1IHsQXFwc0YgyP4SKQb3Ckv+/9UFHK9EzM+WlPxZi7ZOS\nhsWhIfkI4c4ORpxUQ+hPi0K2k+HIY7eYyONqDAzw5PGkKBo3mSGMHDXYywSqexhB\nCCMHuHdMhwyHdz4PWYOK3C2VMQKBgQDnpsrHK7lM9aVb8wNhTokbK5IlTSzH/5oJ\nlAVu6G6H3tM5YQeoDXztbZClvrvKU8DU5UzwaC+8AEWQwaram29QIDpAI3nVQQ0k\ndmHHp/pCeADdRG2whaGcl418UJMMv8AUpWTRm+kVLTLqfTHBC0ji4NlCQMHCUCfd\nU8TeUi5QBQKBgQDvJNd7mboDOUmLG7VgMetc0Y4T0EnuKsMjrlhimau/OYJkZX84\n+BcPXwmnf4nqC3Lzs3B9/12L0MJLvZjUSHQ0mJoZOPxtF0vvasjEEbp0B3qe0wOn\nDQ0NRCUJNNKJbJOfE8VEKnDZ/lx+f/XXk9eINwvElDrLqUBQtr+TxjbyYQKBgAxQ\nlZ8Y9/TbajsFJDzcC/XhzxckjyjisbGoqNFIkfevJNN8EQgiD24f0Py+swUChtHK\njtiI8WCxMwGLCiYs9THxRKd8O1HW73fswy32BBvcfU9F//7OW9UTSXY+YlLfLrrq\nP/3UqAN0L6y/kxGMJAfLpEEdaC+IS1Y8yc531/ZxAoGASYiasDpePtmzXklDxk3h\njEw64QAdXK2p/xTMjSeTtcqJ7fvaEbg+Mfpxq0mdTjfbTdR9U/nzAkwS7OoZZ4Du\nueMVls0IVqcNnBtikG8wgdxN27b5JPXS+GzQ0zDSpWFfRPZiIh37BAXr0D1voluJ\nrEHkcals6p7hL98BoxjFIvA=\n-----END PRIVATE KEY-----\n",
}

OPS = {
    "store": 'this.mark = "stored"; say("stored");',
    "read": 'say("read " + String(this.mark));',
    "call": 'say("called " + String(this.tell()));',
    "delete": 'say("deleted " + String(delete this.mark));',
    "in": 'say("in " + String("mark" in this));',
    "typeof": 'say(typeof this + " " + String(this === undefined) + " " + String(this === null));',
}
HOLDER = 'mark: "of the holder", tell() { return "the holder tells"; }'


def body(op):
    return "if (ran++ === 0) { try { " + OPS[op] + ' } catch (error: any) { say(error.name); } }'


def typed_params(params, typing):
    if typing == "untyped":
        return params
    first = "this: any" if typing == "any" else "this: Holder"
    rest = ", ".join(p.strip() + ": any" for p in params.split(",") if p.strip())
    return first + (", " + rest if rest else "")


# A member of an object that is handed to the host.
def member(name, params, after, op, form, typing):
    p = typed_params(params, typing)
    b = body(op) + " " + after
    key = name if re.match(r"^[A-Za-z_$][\w$]*$", name) else json.dumps(name)
    if form == "method":
        return f"{key}({p}) {{ {b} }}"
    if form == "function":
        return f"{key}: function ({p}) {{ {b} }}"
    if form == "async":
        return f"async {key}({p}) {{ {b} }}"
    if form == "arrow":
        q = typed_params(params, "untyped") if typing == "untyped" else ", ".join(x.strip() + ": any" for x in params.split(",") if x.strip())
        return f"{key}: ({q}) => {{ {b} }}"
    if form == "classproto":
        return f"__proto__: (class {{ {key}({p}) {{ {b} }} }}).prototype"
    if form == "generator":
        return f"*{key}({p}) {{ {b} }}"
    raise Exception(form)


# A function that is handed to the host by itself.
def callback(params, after, op, form, typing):
    p = typed_params(params, typing)
    b = body(op) + " " + after
    if form in ("method", "function"):
        if form == "function":
            return f"function ({p}) {{ {b} }}"
        return f"({{ {HOLDER}, run({p}) {{ {b} }} }}).run"
    if form == "async":
        return f"async function ({p}) {{ {b} }}"
    if form == "arrow":
        q = params if typing == "untyped" else ", ".join(x.strip() + ": any" for x in params.split(",") if x.strip())
        return f"({q}) => {{ {b} }}"
    if form == "generator":
        return f"function* ({p}) {{ {b} }}"
    if form == "asyncgenerator":
        return f"async function* ({p}) {{ {b} }}"
    if form == "classmethod":
        return f"new (class {{ mark = \"of the holder\"; tell() {{ return \"the holder tells\"; }} run({p}) {{ {b} }} }})().run"
    raise Exception(form)


contexts = {}  # name -> (imports, template, kind); in the template @H(name|params|after)@ is a member, @F(params|after)@ a function


def add(name, template, imports=(), group="host"):
    contexts[name] = (imports, template, group)


CERT = f"cert: {json.dumps(tls['cert'])}, key: {json.dumps(tls['key'])}"


def sockets(side, name, secure, data):
    server = {"open": ("socket", ""), "data": ("socket, chunk", 'socket.write("pong");'), "close": ("socket", "oneClosed();"), "error": ("socket, error", ""), "end": ("socket", "socket.end();")}
    client = {"open": ("socket", "" if secure else 'socket.write("ping");'), "data": ("socket, chunk", "socket.end();"), "close": ("socket", "oneClosed();"), "error": ("socket, error", ""), "connectError": ("socket, error", "finish();")}
    if secure:
        client["handshake"] = ("socket, ok, error", 'socket.write("ping");')
    extra = {"end": ("socket", ""), "drain": ("socket", ""), "timeout": ("socket", "socket.end();"), "handshake": ("socket, ok, error", ""), "session": ("socket, session", ""), "keylog": ("socket, line", ""),
             "serverName": ("given, name, socket", ""), "alpnCallback": ("socket, name, protocols", 'return "h2";')}
    mine = server if side == "server" else client
    if name not in mine:
        mine[name] = extra[name]
    if name == "error":
        mine["data"] = ("socket, chunk", 'throw new Error("thrown by data");')
        mine["error"] = ("socket, error", "socket.end();")
    if name == "end" and side == "client":
        server["data"] = ("socket, chunk", "socket.end();")
        client["data"] = ("socket, chunk", "")
        client["end"] = ("socket", "socket.end();")
    if name == "timeout":
        mine["open"] = ("socket", "socket.timeout(1);")
        if side == "server":
            client["open"] = ("socket", "")
            client.pop("handshake", None)
    def literal(handlers, tested):
        parts = [HOLDER] if tested else []
        for n, (p, a) in handlers.items():
            parts.append(f"@H({n}|{p}|{a})@" if tested and n == name else f"{n}({p}) {{ {a} }}")
        return "{ " + ", ".join(parts) + " }"
    d = 'data: { other: 1, mark: "of the data", tell() { return "the data tells"; } }, ' if data else ""
    ts = f"tls: {{ {CERT} }}, " if secure else ""
    alpn = ', ALPNProtocols: "\\x02h2"' if name == "alpnCallback" else ""
    tc = f'tls: {{ serverName: "localhost", rejectUnauthorized: false{alpn} }}, ' if secure else ""
    return f"""let closed = 0;
const oneClosed = () => {{ if (++closed === 2) finish(); }};
const listener = Bun.listen({{ hostname: "127.0.0.1", port: 0, {ts}{d if side == "server" else ""}socket: {literal(server, side == "server")} }} as any);
cleanup = () => listener.stop(true);
Bun.connect({{ hostname: "127.0.0.1", port: listener.port, {tc}{d if side == "client" else ""}socket: {literal(client, side == "client")} }} as any).catch(() => {{}});"""


for data in (False, True):
    w = "-with-data" if data else ""
    for n in ("open", "data", "close", "error", "end", "drain", "timeout"):
        add(f"listen-{n}{w}", sockets("server", n, False, data))
        add(f"connect-{n}{w}", sockets("client", n, False, data))
    for n in ("open", "data", "close", "handshake", "session", "keylog", "serverName", "alpnCallback"):
        add(f"listen-tls-{n}{w}", sockets("server", n, True, data))
    for n in ("open", "data", "close", "handshake", "session", "keylog"):
        add(f"connect-tls-{n}{w}", sockets("client", n, True, data))
    d = 'data: { other: 1, mark: "of the data", tell() { return "the data tells"; } }, ' if data else ""
    add(f"connect-connectError{w}", f"""const listener = Bun.listen({{ hostname: "127.0.0.1", port: 0, socket: {{ data() {{}} }} }});
const port = listener.port; listener.stop(true);
Bun.connect({{ hostname: "127.0.0.1", port, {d}socket: {{ {HOLDER}, data() {{}}, @H(connectError|socket, error|finish();)@ }} }} as any).catch(() => {{}});""")

SERVE = 'hostname: "127.0.0.1", port: 0'
add("serve-fetch", f"""const server = Bun.serve({{ {SERVE}, {HOLDER}, @H(fetch|request, server|return new Response("ok");)@ }} as any);
cleanup = () => server.stop(true);
await (await fetch(server.url)).text(); finish();""")
add("serve-error", f"""const server = Bun.serve({{ {SERVE}, {HOLDER}, fetch() {{ throw new Error("thrown by fetch"); }}, @H(error|error|return new Response("handled");)@ }} as any);
cleanup = () => server.stop(true);
await (await fetch(server.url)).text(); finish();""")
add("serve-route", f"""const server = Bun.serve({{ {SERVE}, routes: {{ @H(/r|request, server|return new Response("ok");)@ }} }} as any);
cleanup = () => server.stop(true);
await (await fetch(new URL("/r", server.url))).text(); finish();""")
add("serve-route-by-method", f"""const server = Bun.serve({{ {SERVE}, routes: {{ "/r": {{ @H(GET|request, server|return new Response("ok");)@ }} }} }} as any);
cleanup = () => server.stop(true);
await (await fetch(new URL("/r", server.url))).text(); finish();""")
for n, p, drive in (("open", "socket", ""), ("message", "socket, message", 'client.onopen = () => client.send("x");'), ("close", "socket, code, reason", "client.onopen = () => client.close();"),
                    ("ping", "socket, frame", "client.onopen = () => client.ping();"), ("pong", "socket, frame", "client.onopen = () => client.pong();")):
    for data in (False, True):
        up = 'server.upgrade(request, { data: { other: 1, mark: "of the data", tell() { return "the data tells"; } } })' if data else "server.upgrade(request)"
        others = "" if n == "message" else "message() {}, "
        add(f"serve-websocket-{n}" + ("-with-data" if data else ""), f"""const server = Bun.serve({{ {SERVE}, fetch(request, server) {{ {up}; }}, websocket: {{ {HOLDER}, {others}@H({n}|{p}|finish();)@ }} }} as any);
const client: any = new WebSocket(String(server.url).replace("http", "ws"));
cleanup = () => {{ client.close(); server.stop(true); }};
{drive}""")
add("udp-data", f"""const socket = await Bun.udpSocket({{ hostname: "127.0.0.1", port: 0, socket: {{ {HOLDER}, @H(data|socket, chunk, port, address|finish();)@ }} }} as any);
cleanup = () => socket.close();
socket.send("x", socket.port, "127.0.0.1");""")
add("udp-error", f"""const socket = await Bun.udpSocket({{ hostname: "127.0.0.1", port: 0, socket: {{ {HOLDER}, data() {{ throw new Error("thrown by data"); }}, @H(error|error|finish();)@ }} }} as any);
cleanup = () => socket.close();
socket.send("x", socket.port, "127.0.0.1");""")
add("spawn-onExit", f"""Bun.spawn(["/bin/echo", "x"], {{ stdout: "ignore", {HOLDER}, @H(onExit|child, code, signal, error|finish();)@ }} as any);""")
SELF = 'const self = process.argv[1].startsWith("/$bunfs") ? [process.execPath] : [process.execPath, process.argv[1]];'
add("spawn-ipc", f"""if (process.argv[2] === "child") {{ process.send!("from the child"); process.disconnect!(); return; }}
{SELF}
Bun.spawn([...self, "child"], {{ stdout: "ignore", stderr: "ignore", {HOLDER}, @H(ipc|message, child|finish();)@ }} as any);""")
add("spawn-onDisconnect", f"""if (process.argv[2] === "child") {{ process.disconnect!(); return; }}
{SELF}
Bun.spawn([...self, "child"], {{ stdout: "ignore", stderr: "ignore", {HOLDER}, ipc() {{}}, @H(onDisconnect|ok|finish();)@ }} as any);""")

for n, call in (("setTimeout", "setTimeout(@F(|finish();)@, 1);"), ("setInterval", "const timer = setInterval(@F(|clearInterval(timer); finish();)@, 1);"), ("setImmediate", "setImmediate(@F(|finish();)@);"),
                ("queueMicrotask", "queueMicrotask(@F(|finish();)@);"), ("nextTick", "process.nextTick(@F(|finish();)@);"),
                ("process-on-emit", 'process.on("custom" as any, @F(value|finish();)@); process.emit("custom" as any, 1);'),
                ("process-on-signal", 'process.on("SIGUSR2", @F(name, number|finish();)@); process.kill(process.pid, "SIGUSR2");'),
                ("process-on-uncaughtException", 'process.on("uncaughtException", @F(error, origin|finish();)@); setTimeout(() => { throw new Error("thrown by a timer"); }, 1);'),
                ("process-on-unhandledRejection", 'process.on("unhandledRejection", @F(reason, promise|finish();)@); Promise.reject(new Error("rejected"));'),
                ("process-on-beforeExit", 'clearTimeout(watchdog); process.on("beforeExit", @F(code|finish();)@);'),
                ("event-target", 'const target = new EventTarget(); target.addEventListener("e", @F(event|finish();)@); target.dispatchEvent(new Event("e"));'),
                ("abort-signal", 'const controller = new AbortController(); controller.signal.addEventListener("abort", @F(event|finish();)@); controller.abort();'),
                ("abort-signal-onabort", "const controller = new AbortController(); controller.signal.onabort = @F(event|finish();)@; controller.abort();"),
                ("global-event", 'addEventListener("e", @F(event|finish();)@); dispatchEvent(new Event("e"));'),
                ("message-port", "const channel = new MessageChannel(); cleanup = () => { channel.port1.close(); channel.port2.close(); }; channel.port1.onmessage = @F(event|finish();)@; channel.port2.postMessage(1);"),
                ("broadcast-channel", 'const a = new BroadcastChannel("c"), b = new BroadcastChannel("c"); cleanup = () => { a.close(); b.close(); }; a.onmessage = @F(event|finish();)@; b.postMessage(1);'),
                ("finalization-registry", "const registry = new FinalizationRegistry(@F(held|finish();)@); (() => { registry.register({}, 1); })(); for (let i = 0; i < 20 && ran === 0; i++) { Bun.gc(true); await new Promise(r => setTimeout(r, 5)); } finish();"),
                ("promise-executor", "new Promise(@F(resolve, reject|finish();)@);"), ("promise-then", "Promise.resolve(1).then(@F(value|finish();)@);"),
                ("promise-catch", "Promise.reject(1).catch(@F(value|finish();)@);"), ("promise-finally", "Promise.resolve(1).finally(@F(|finish();)@);"),
                ("string-replace", '"a".replace("a", @F(match|finish(); return "";)@ as any);'), ("string-replace-regexp", '"a".replace(/a/g, @F(match|finish(); return "";)@ as any);'),
                ("json-parse-reviver", "JSON.parse('{\"mark\":\"of the parsed\"}', @F(key, value|finish(); return value;)@);"),
                ("json-stringify-replacer", 'JSON.stringify({ mark: "of the value" }, @F(key, value|finish(); return value;)@ as any);'),
                ("array-sort", "[2, 1].sort(@F(a, b|finish(); return a - b;)@);"), ("array-toSorted", "[2, 1].toSorted(@F(a, b|finish(); return a - b;)@);"),
                ("array-reduce", "[1, 2].reduce(@F(a, b|finish(); return a;)@);"), ("array-reduceRight", "[1, 2].reduceRight(@F(a, b|finish(); return a;)@);"),
                ("typed-array-sort", "new Int8Array([2, 1]).sort(@F(a, b|finish(); return a - b;)@);"),
                ("object-groupBy", 'Object.groupBy([1], @F(value|finish(); return "k";)@);'), ("map-groupBy", 'Map.groupBy([1], @F(value|finish(); return "k";)@);'),
                ("iterator-map", "[1].values().map(@F(value|finish();)@).next();"), ("iterator-forEach", "[1].values().forEach(@F(value|finish();)@);"),
                ("iterator-reduce", "[1, 2].values().reduce(@F(a, b|finish(); return a;)@);"),
                ("tagged-template", "(@F(strings|finish();)@)``;"), ("plain-call", "const f = @F(|finish();)@; f();"), ("comma-call", "(0, @F(|finish();)@)();"),
                ("new-function", "const f: any = @F(|finish();)@; try { new f(); } catch (error: any) { say(error.name); finish(); }"),
                ("array-fromAsync", "await Array.fromAsync([1], @F(value|finish();)@);"),
                ("error-prepareStackTrace", '(Error as any).prepareStackTrace = @F(error, sites|finish(); return "";)@; new Error("e").stack; finish();'),
                ("async-local-storage-run", "new AsyncLocalStorage().run(1, @F(|finish();)@);"),
                ("bun-cron-like-sleep-then", "Bun.sleep(1).then(@F(|finish();)@);"),
                ):
    add(n, call, imports=(("{ AsyncLocalStorage }", "node:async_hooks"),) if "AsyncLocalStorage" in call else (), group="host" if not re.match(r"promise|string|json|array|typed|object|map-|iterator|tagged|plain|comma|new-|error-", n) else "language")

# Objects whose members a built-in or the host calls.
for n, t in (("handleEvent", f'const target = new EventTarget(); target.addEventListener("e", {{ {HOLDER}, @H(handleEvent|event|finish();)@ }}); target.dispatchEvent(new Event("e"));'),
             ("toJSON", f"JSON.stringify({{ {HOLDER}, @H(toJSON|key|finish(); return 1;)@ }});"), ("valueOf", f"+({{ {HOLDER}, @H(valueOf||finish(); return 1;)@ }} as any);"),
             ("toString", f"String({{ {HOLDER}, @H(toString||finish(); return \"\";)@ }});"),
             ("thenable", f"await ({{ {HOLDER}, @H(then|resolve, reject|finish(); resolve(1);)@ }} as any);"),
             ("iterator-next", f"for (const x of {{ [Symbol.iterator]() {{ return {{ {HOLDER}, @H(next||finish(); return {{ done: true, value: 1 }};)@ }}; }} }} as any) {{}}"),
             ("proxy-get-trap", f"(new Proxy({{}}, {{ {HOLDER}, @H(get|target, key, receiver|finish(); return 1;)@ }} as any) as any).x;"),
             ("readable-stream-start", f"new ReadableStream({{ {HOLDER}, @H(start|controller|finish();)@ }} as any);"),
             ("readable-stream-pull", f"new ReadableStream({{ {HOLDER}, @H(pull|controller|controller.close(); finish();)@ }} as any).getReader().read();"),
             ("readable-stream-cancel", f"new ReadableStream({{ {HOLDER}, @H(cancel|reason|finish();)@ }} as any).cancel();"),
             ("direct-stream-pull", f"new Response(new ReadableStream({{ type: \"direct\", {HOLDER}, @H(pull|controller|controller.close(); finish();)@ }} as any)).text();"),
             ("writable-stream-write", f"new WritableStream({{ {HOLDER}, @H(write|chunk, controller|finish();)@ }} as any).getWriter().write(1);"),
             ("writable-stream-close", f"new WritableStream({{ {HOLDER}, @H(close||finish();)@ }} as any).getWriter().close();"),
             ("transform-stream-transform", f"const stream = new TransformStream({{ {HOLDER}, @H(transform|chunk, controller|finish();)@ }} as any); stream.writable.getWriter().write(1); stream.readable.getReader().read();"),
             ("queuing-strategy-size", f"new ReadableStream({{ start(controller) {{ controller.enqueue(1); }} }}, {{ {HOLDER}, highWaterMark: 1, @H(size|chunk|finish(); return 1;)@ }} as any);"),
             ("html-rewriter-element", f"new HTMLRewriter().on(\"p\", {{ {HOLDER}, @H(element|element|finish();)@ }} as any).transform(\"<p>x</p>\");"),
             ("html-rewriter-text", f"new HTMLRewriter().on(\"p\", {{ {HOLDER}, @H(text|text|finish();)@ }} as any).transform(\"<p>x</p>\");"),
             ("html-rewriter-document-end", f"new HTMLRewriter().onDocument({{ {HOLDER}, @H(end|end|finish();)@ }} as any).transform(\"<p>x</p>\");"),
             ("inspect-custom", f"Bun.inspect({{ {HOLDER}, [Bun.inspect.custom]: @F(depth, options|finish(); return \"\";)@ }});"),
             ("websocket-client-onopen", f"const server = Bun.serve({{ {SERVE}, fetch(request, server) {{ server.upgrade(request); }}, websocket: {{ message() {{}} }} }} as any); const client = new WebSocket(String(server.url).replace(\"http\", \"ws\")); cleanup = () => {{ client.close(); server.stop(true); }}; client.onopen = @F(event|finish();)@;"),
             ("fetch-checkServerIdentity", f"const server = Bun.serve({{ {SERVE}, tls: {{ {CERT} }}, fetch() {{ return new Response(\"ok\"); }} }}); cleanup = () => server.stop(true); await fetch(server.url, {{ tls: {{ rejectUnauthorized: false, {HOLDER}, @H(checkServerIdentity|host, certificate|finish();)@ }} }} as any).then(r => r.text(), () => {{}}); finish();"),
             ("socket-reload", f"""let closed = 0; const listener = Bun.listen({{ hostname: "127.0.0.1", port: 0, socket: {{ open(socket) {{ socket.reload({{ socket: {{ {HOLDER}, @H(data|socket, chunk|socket.end(); finish();)@ }} }} as any); }}, data() {{}} }} }});
cleanup = () => listener.stop(true);
Bun.connect({{ hostname: "127.0.0.1", port: listener.port, socket: {{ open(socket) {{ setTimeout(() => socket.write("ping"), 5); }}, data() {{}} }} }}).catch(() => {{}});"""),
             ("listener-reload", f"""const listener = Bun.listen({{ hostname: "127.0.0.1", port: 0, socket: {{ data() {{}} }} }});
listener.reload({{ socket: {{ {HOLDER}, @H(data|socket, chunk|socket.end(); finish();)@ }} }} as any);
cleanup = () => listener.stop(true);
Bun.connect({{ hostname: "127.0.0.1", port: listener.port, socket: {{ open(socket) {{ socket.write("ping"); }}, data() {{}} }} }}).catch(() => {{}});"""),
             ("server-reload-fetch", f"""const server = Bun.serve({{ {SERVE}, fetch() {{ return new Response("old"); }} }});
server.reload({{ {HOLDER}, @H(fetch|request, server|return new Response("ok");)@ }} as any);
cleanup = () => server.stop(true);
await (await fetch(server.url)).text(); finish();"""),
             ):
    add(n, t, group="language" if n in ("toJSON", "valueOf", "toString", "thenable", "iterator-next", "proxy-get-trap") else "host")

NODE = (
    ("node-emitter-on", (("{ EventEmitter }", "node:events"),), 'const emitter = new EventEmitter(); emitter.on("e", @F(value|finish();)@); emitter.emit("e", 1);'),
    ("node-emitter-once", (("{ EventEmitter }", "node:events"),), 'const emitter = new EventEmitter(); emitter.once("e", @F(value|finish();)@); emitter.emit("e", 1);'),
    ("node-fs-stat", (("fs", "node:fs"),), 'fs.stat("/", @F(error, stats|finish();)@);'),
    ("node-fs-readdir", (("fs", "node:fs"),), 'fs.readdir(".", @F(error, names|finish();)@);'),
    ("node-dns-lookup", (("dns", "node:dns"),), 'dns.lookup("127.0.0.1", @F(error, address|finish();)@);'),
    ("node-zlib-gzip", (("zlib", "node:zlib"),), 'zlib.gzip("x", @F(error, bytes|finish();)@);'),
    ("node-crypto-randomBytes", (("crypto", "node:crypto"),), "crypto.randomBytes(1, @F(error, bytes|finish();)@);"),
    ("node-crypto-pbkdf2", (("crypto", "node:crypto"),), 'crypto.pbkdf2("p", "s", 1, 8, "sha1", @F(error, bytes|finish();)@);'),
    ("node-child-process-execFile", (("child_process", "node:child_process"),), 'child_process.execFile("/bin/echo", ["x"], @F(error, stdout|finish();)@);'),
    ("node-net-connection", (("net", "node:net"),), 'const server = net.createServer(@F(socket|socket.destroy(); finish();)@); cleanup = () => server.close(); server.listen(0, "127.0.0.1", () => net.connect((server.address() as any).port, "127.0.0.1").on("error", () => {}));'),
    ("node-net-listen-callback", (("net", "node:net"),), 'const server = net.createServer(); cleanup = () => server.close(); server.listen(0, "127.0.0.1", @F(|finish();)@);'),
    ("node-net-socket-data", (("net", "node:net"),), 'const server = net.createServer(socket => { socket.on("data", @F(chunk|finish();)@); }); cleanup = () => { client.destroy(); server.close(); }; let client: any; server.listen(0, "127.0.0.1", () => { client = net.connect((server.address() as any).port, "127.0.0.1", () => client.write("x")); });'),
    ("node-http-request", (("http", "node:http"),), 'const server = http.createServer(@F(request, response|response.end("ok");)@); cleanup = () => server.close(); server.listen(0, "127.0.0.1", async () => { await (await fetch("http://127.0.0.1:" + (server.address() as any).port)).text(); finish(); });'),
    ("node-http-get-callback", (("http", "node:http"),), 'const server = http.createServer((request, response) => response.end("ok")); cleanup = () => server.close(); server.listen(0, "127.0.0.1", () => { http.get("http://127.0.0.1:" + (server.address() as any).port, @F(response|response.resume(); finish();)@); });'),
    ("node-dgram-message", (("dgram", "node:dgram"),), 'const socket = dgram.createSocket("udp4"); cleanup = () => socket.close(); socket.on("message", @F(message, info|finish();)@); socket.bind(0, "127.0.0.1", () => socket.send("x", socket.address().port, "127.0.0.1"));'),
    ("node-stream-read", (("{ Readable }", "node:stream"),), f"new Readable({{ {HOLDER}, @H(read|size|this.push?.(null); finish();)@ }} as any).resume();"),
    ("node-stream-write", (("{ Writable }", "node:stream"),), f'new Writable({{ {HOLDER}, @H(write|chunk, encoding, callback|callback(); finish();)@ }} as any).write("x");'),
    ("node-stream-transform", (("{ Transform }", "node:stream"),), f'new Transform({{ {HOLDER}, @H(transform|chunk, encoding, callback|callback(); finish();)@ }} as any).write("x");'),
    ("node-stream-finished", (("streams", "node:stream"),), "const stream = streams.Readable.from([]); streams.finished(stream, @F(error|finish();)@); stream.resume();"),
    ("node-util-callbackify", (("util", "node:util"),), "util.callbackify(async () => 1)(@F(error, value|finish();)@);"),
    ("node-util-promisify", (("util", "node:util"),), "util.promisify(@F(callback|callback(null, 1); finish();)@)();"),
    ("node-async-resource", (("{ AsyncResource }", "node:async_hooks"),), 'new AsyncResource("r").runInAsyncScope(@F(|finish();)@);'),
    ("node-async-resource-this", (("{ AsyncResource }", "node:async_hooks"),), 'new AsyncResource("r").runInAsyncScope(@F(|finish();)@, { mark: "of the argument", tell() { return "the argument tells"; } });'),
    ("node-timers-setTimeout", (("timers", "node:timers"),), "timers.setTimeout(@F(|finish();)@, 1);"),
    ("node-tls-SNICallback", (("tls", "node:tls"),), f'const server = tls.createServer({{ {CERT}, {HOLDER}, @H(SNICallback|name, callback|callback(null); finish();)@ }} as any); cleanup = () => {{ client?.destroy(); server.close(); }}; let client: any; server.listen(0, "127.0.0.1", () => {{ client = tls.connect({{ port: (server.address() as any).port, host: "127.0.0.1", servername: "localhost", rejectUnauthorized: false }}); client.on("error", () => {{}}); }});'),
    ("node-tls-ALPNCallback", (("tls", "node:tls"),), f'const server = tls.createServer({{ {CERT}, {HOLDER}, @H(ALPNCallback|offer|finish(); return "h2";)@ }} as any); cleanup = () => {{ client?.destroy(); server.close(); }}; let client: any; server.listen(0, "127.0.0.1", () => {{ client = tls.connect({{ port: (server.address() as any).port, host: "127.0.0.1", servername: "localhost", ALPNProtocols: ["h2"], rejectUnauthorized: false }}); client.on("error", () => {{}}); }});'),
    ("node-tls-checkServerIdentity", (("tls", "node:tls"),), f'const server = tls.createServer({{ {CERT} }}); cleanup = () => {{ client?.destroy(); server.close(); }}; let client: any; server.listen(0, "127.0.0.1", () => {{ client = tls.connect({{ port: (server.address() as any).port, host: "127.0.0.1", servername: "localhost", ca: {json.dumps(tls["cert"])}, {HOLDER}, @H(checkServerIdentity|host, certificate|finish();)@ }} as any); client.on("error", () => {{}}); }});'),
    ("node-tls-keylog", (("tls", "node:tls"),), f'const server = tls.createServer({{ {CERT} }}); cleanup = () => {{ client?.destroy(); server.close(); }}; let client: any; server.on("keylog", @F(line, socket|finish();)@); server.listen(0, "127.0.0.1", () => {{ client = tls.connect({{ port: (server.address() as any).port, host: "127.0.0.1", rejectUnauthorized: false }}); client.on("error", () => {{}}); }});'),
    ("node-tls-session", (("tls", "node:tls"),), f'const server = tls.createServer({{ {CERT} }}); cleanup = () => {{ client?.destroy(); server.close(); }}; let client: any; server.listen(0, "127.0.0.1", () => {{ client = tls.connect({{ port: (server.address() as any).port, host: "127.0.0.1", rejectUnauthorized: false }}); client.on("error", () => {{}}); client.on("session", @F(session|finish();)@); }});'),
)
for n, i, t in NODE:
    add(n, t, imports=i)

THIS = {"none": None, "undefined": "undefined", "null": "null", "number": "1", "string": '"s"', "symbol": "Symbol.iterator", "bigint": "1n", "boolean": "true",
        "object": '{ mark: "of the argument", tell() { return "the argument tells"; } }'}
for m in ("forEach", "map", "filter", "some", "every", "find", "findIndex", "findLast", "findLastIndex", "flatMap"):
    for k, v in THIS.items():
        if m != "forEach" and k not in ("none", "number", "object"):
            continue
        add(f"array-{m}-this-{k}", f"[1].{m}(@F(value|finish();)@" + (f", {v}" if v else "") + ");", group="language")
for k, v in THIS.items():
    a = f", {v}" if v else ""
    add(f"typed-array-forEach-this-{k}", f"new Int8Array(1).forEach(@F(value|finish();)@{a});", group="language")
    add(f"map-forEach-this-{k}", f"new Map([[1, 1]]).forEach(@F(value|finish();)@{a});", group="language")
    add(f"set-forEach-this-{k}", f"new Set([1]).forEach(@F(value|finish();)@{a});", group="language")
    add(f"array-from-this-{k}", f"Array.from([1], @F(value|finish();)@{a});", group="language")
    if v:
        add(f"call-this-{k}", f"(@F(|finish();)@ as any).call({v});", group="language")
        add(f"apply-this-{k}", f"(@F(|finish();)@ as any).apply({v}, []);", group="language")
        add(f"bind-this-{k}", f"(@F(|finish();)@ as any).bind({v})();", group="language")
        add(f"reflect-apply-this-{k}", f"Reflect.apply(@F(|finish();)@, {v}, []);", group="language")
        add(f"call-call-this-{k}", f"Function.prototype.call.call(@F(|finish();)@, {v});", group="language")
        add(f"bound-timer-this-{k}", f"setTimeout((@F(|finish();)@ as any).bind({v}), 1);", group="language")
        add(f"getter-receiver-{k}", f"Reflect.get({{ {HOLDER}, get x() {{ return (@F(|finish();)@ as any).call(this); }} }}, \"x\", {v});", group="language")


MORE = (
    ("server-fetch-method", f'''const server = Bun.serve({{ {SERVE}, {HOLDER}, @H(fetch|request, server|return new Response("ok");)@ }} as any);
cleanup = () => server.stop(true);
await (await server.fetch(new Request(server.url))).text(); finish();'''),
    ("timer-onTimeout", "const timer: any = setTimeout(() => {}, 5); timer._onTimeout = @F(|finish();)@;"),
    ("process-on-exit", 'process.on("exit", @F(code|console.log(said.join());)@); finish();'),
    ("performance-observer", 'const observer = new PerformanceObserver(@F(list, observer|finish();)@); cleanup = () => observer.disconnect(); observer.observe({ entryTypes: ["mark"] }); performance.mark("m");'),
    ("bun-plugin-setup", f'Bun.plugin({{ name: "p", {HOLDER}, @H(setup|build|finish();)@ }} as any);'),
    ("bun-build-setup", f'Bun.build({{ entrypoints: ["/nowhere.js"], plugins: [{{ name: "p", {HOLDER}, @H(setup|build|finish();)@ }}] }} as any).catch(() => {{}}).then(() => finish());'),
) + tuple((f"upgradeTLS-{n}", f'''const listener = Bun.listen({{ hostname: "127.0.0.1", port: 0, tls: {{ {CERT} }}, socket: {{ data(socket) {{ socket.write("pong"); }} }} }});
cleanup = () => listener.stop(true);
Bun.connect({{ hostname: "127.0.0.1", port: listener.port, socket: {{ data() {{}}, open(raw) {{
  raw.upgradeTLS({{ tls: {{ serverName: "localhost", rejectUnauthorized: false }}, data: {{ other: 1, mark: "of the data", tell() {{ return "the data tells"; }} }}, socket: {{ {HOLDER}, {others}@H({n}|{p}|{a})@ }} }} as any);
}} }} }} as any).catch(() => {{}});''') for n, p, a, others in (
    ("handshake", "socket, ok, error", "finish();", "data() {}, "), ("open", "socket", "finish();", "data() {}, "), ("keylog", "socket, line", "finish();", "data() {}, "),
    ("data", "socket, chunk", "finish();", 'handshake(socket) { socket.write("ping"); }, '), ("session", "socket, session", "finish();", 'data() {}, handshake(socket) { socket.write("ping"); }, ')))
for n, t in MORE:
    add(n, t, group="host")
for k, v in THIS.items():
    if v:
        add(f"next-of-call-this-{k}", f"(@F(|finish();)@ as any).call({v}).next(); finish();", group="generators")
add("next-of-method", f"({{ {HOLDER}, @H(run||finish();)@ }} as any).run().next(); finish();", group="generators")


def program(name, op, form, mode, typing):
    imports, template, _ = contexts[name]
    def expand_member(m):
        n, p, a = m.group(1).split("|", 2)
        return member(n, p, a, op, {"classmethod": "method", "asyncgenerator": "generator"}.get(form, form), typing)
    def expand_function(m):
        p, a = m.group(1).split("|", 1)
        return callback(p, a, op, form, typing)
    text = re.sub(r"@H\((.*?)\)@", expand_member, template, flags=re.S)
    text = re.sub(r"@F\((.*?)\)@", expand_function, text, flags=re.S)
    ts = typing != "untyped"
    if not ts:
        text = re.sub(r" as any\b", "", text)
        text = re.sub(r"\b(client|f|error|timer): any\b", r"\1", text)
        text = text.replace("process.send!(", "process.send(").replace("process.disconnect!(", "process.disconnect(")
    head = []
    for what, where in imports:
        head.append(f'const {what} = require("{where}");' if mode == "sloppy" else f'import {what} from "{where}";')
    any_ = ": any" if ts else ""
    strings = ": string[]" if ts else ""
    if typing == "class":
        head.append('class Holder { mark = "of the holder"; tell(): string { return "the holder tells"; } }')
    head.append(f"const said{strings} = []; const say = (line{': string' if ts else ''}) => {{ said.push(line); }}; let ran = 0; let cleanup{any_} = () => {{}};")
    head.append("const finished = Promise.withResolvers" + ("<void>" if ts else "") + "(); const finish = () => finished.resolve();")
    head.append('const watchdog = setTimeout(() => { say("watchdog"); finish(); }, 30000);')
    main = "async function main() {\n" + text + "\nawait finished.promise; clearTimeout(watchdog); cleanup(); console.log(said.join(\"\\n\"));\n}\nmain();\n"
    return "\n".join(head) + "\n" + main + ("module.exports = {};\n" if mode == "sloppy" else "export {};\n")


# Who is not asked: what another platform lacks, what hangs on when the collector runs, what is never called, and what ends the program with an error that nobody catches.
LEFT_OUT = re.compile(r"^(spawn-|process-on-signal$|node-child-process|finalization-registry$|(listen|connect)-drain|listen-tls-session|node-tls-session$|fetch-checkServerIdentity$|bun-plugin-setup$|bun-build-setup$)")
ENDS_BY_AN_ERROR = {("toString", "async"), ("queuing-strategy-size", "async"), ("node-stream-read", "arrow"), ("node-util-promisify", "async"), ("serve-route", "classproto"), ("serve-route-by-method", "classproto")}

cases = []
def emit(name, op, form, mode, typing):
    if typing == "untyped" and not LEFT_OUT.match(name) and (name, form) not in ENDS_BY_AN_ERROR:
        cases.append((name, op, form, mode))


for name, (_, template, group) in contexts.items():
    plain = "@F(" in template
    if group == "generators":
        for form in ("generator", "asyncgenerator"):
            for op in OPS:
                emit(name, op, form, "strict", "untyped")
                emit(name, op, form, "sloppy", "untyped")
        continue
    if not plain:
        for op in ("store", "read", "typeof"):
            emit(name, op, "classproto", "strict", "untyped")
        emit(name, "store", "classproto", "sloppy", "untyped")
    for op in OPS:
        emit(name, op, "method", "strict", "untyped")
    for op in ("store", "read", "typeof"):
        emit(name, op, "method", "sloppy", "untyped")
    for form in ("function", "async", "arrow") + (("classmethod",) if plain else ()):
        for op in ("store", "read"):
            emit(name, op, form, "strict", "untyped")
        emit(name, "store", form, "sloppy", "untyped")
    for typing in ("any", "class"):
        for op in ("store", "read", "call"):
            emit(name, op, "method", "strict", typing)
if seed < 0:
    print(len(cases))
else:
    # The handlers of TLS sockets come first: the first seeds always run.
    cases.sort(key=lambda case: (not re.search(r"tls-(serverName|session|keylog|alpnCallback)", case[0]), case[1] != "read", case[3] != "strict"))
    name, op, form, mode = cases[seed % len(cases)]
    print(f"// {name}: {op}, {form}, {mode}")
    print(program(name, op, form, mode, "untyped"), end="")
