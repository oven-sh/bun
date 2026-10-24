// Fields get other types through aliases: computed keys, Object.assign, entries loops, JSON data.
class Config { constructor() { this.port = 80; this.host = "h"; this.on = true; this.list = [1, 2, 3]; } twice() { return this.port * 2; } }
const c = new Config();
const data = JSON.parse('{"port":"8080","host":5,"on":null,"list":{"length":1},"extra":[1]}');
for (const [k, v] of Object.entries(data)) c[k] = v;
console.log(c.twice(), typeof c.port, c.host + 1, c.on, c.list.length, c.extra[0], Object.keys(c).join());
const c2 = Object.assign(new Config(), data);
console.log(c2.twice(), typeof c2.port, c2.host + 1, c2.on, c2.list.length);
const c3 = new Config();
const key = JSON.parse('"port"');
c3[key] = { valueOf() { return 21; } };
console.log(c3.twice(), typeof c3.port);
const c4 = { ...new Config(), ...data };
console.log(c4.port + 1, typeof c4.host);
function setAll(o, src) { for (const k in src) o[k] = src[k]; return o; }
const c5 = setAll(new Config(), { port: 1.5, host: undefined });
console.log(c5.twice(), c5.host, c5.port | 0);
const c6 = new Config(); delete c6.port; console.log(c6.twice(), "port" in c6, Object.keys(c6).join());
const c7 = new Config(); Object.defineProperty(c7, "port", { get() { return "g"; }, configurable: true }); console.log(c7.twice(), c7.port);
