// Hono's SmartRouter in small: the first call of match() stores an own `match` that hides the method.
var Reg = class {
  name = "Reg";
  #routes = [];
  add(m, p, h) { this.#routes.push([m, p, h]); }
  match(method, path) { return [[this.name, method, path, this.#routes.length]]; }
};
var Smart = class {
  name = "Smart";
  #routers = [];
  #routes = [];
  constructor(init) { this.#routers = init.routers; }
  add(method, path, handler) {
    if (!this.#routes) throw new Error("built");
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) throw new Error("Fatal error");
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) router.add(...routes[i2]);
        res = router.match(method, path);
      } catch (e) { throw e; }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) throw new Error("Fatal error");
    this.name = `Smart + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) throw new Error("No active router has been determined yet.");
    return this.#routers[0];
  }
};
class App {
  router;
  constructor(options) { this.router = options.router ?? new Smart({ routers: [new Reg()] }); }
  add(m, p, h) { this.router.add(m, p, h); }
  dispatch(method, path) { const matchResult = this.router.match(method, path); return JSON.stringify(matchResult); }
}
const app = new App({});
app.add("GET", "/text", () => 1);
for (let i = 0; i < 4; i++) console.log(app.dispatch("GET", "/text" + i), app.router.name);
