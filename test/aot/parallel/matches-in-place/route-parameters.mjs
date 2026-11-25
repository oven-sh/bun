import { EventEmitter } from "node:events";
const table = new Map([["home", /^\/(\w+)?$/], ["item", /^\/item\/(\w+)(?:\?q=(\w+))?$/]]);
class Router extends EventEmitter { handle(path) { for (const [name, re] of table) { const m = re.exec(path); if (m) { const params = []; for (let i = 1; i < m.length; i++) params.push(m[i] ?? "-"); this.emit(name, params); return; } } this.emit("none", [path]); } }
const r = new Router(); for (const n of ["home", "item", "none"]) r.on(n, p => console.log(n, p.join()));
for (const p of ["/item/a?q=b", "/item/c", "/", "/x", "/item/d?q=e", "/q/q"]) r.handle(p);
