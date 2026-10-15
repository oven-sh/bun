const body: any = JSON.parse('{"n":"wrong","five":5}');
const untyped = (x: unknown) => x as any;
const row = (name: string, f: () => unknown) => { try { console.log(name, String(f())); } catch { console.log(name, "thrown"); } };
class Router {
  routes = new Map<string, (n: number) => string>();
  get(path: string, handler: (n: number) => string): void { this.routes.set(path, handler); }
  run(path: string, from: any): string { return this.routes.get(path)!(from); }
}
class App {
  prefix = "p"; count = 0; router = new Router();
  field = (n: number): string => this.prefix + " field " + n + " " + ++this.count;
  static shared = "S";
  static fixed = (n: number): string => App.shared + " static " + n + " " + (this === App);
  register(): void {
    this.router.get("/method", (n: number) => this.prefix + " method " + n + " " + ++this.count);
    this.router.get("/field", this.field);
    this.router.get("/static", App.fixed);
  }
}
class Base { router = new Router(); constructor(public name: string) {} describe(): string { return "base " + this.name; } }
class Derived extends Base {
  count = 0;
  constructor() { super("derived"); this.router.get("/constructor", (n: number) => this.name + " constructor " + n + " " + ++this.count); }
  register(): void { const described = super.describe(); this.router.get("/super", (n: number) => described + " method " + n + " " + ++this.count); }
}
class Service {
  prefix = "s";
  field = (a: string, b: number): string => this.prefix + " field " + a + b;
  makes() { return (a: string, b: number): string => this.prefix + " made " + a + b; }
}
const app = new App(); app.register();
const derived = new Derived(); derived.register();
for (const path of ["/method", "/field", "/static"]) row(path, () => app.router.run(path, body.n) + " | " + app.router.run(path, body.five));
for (const path of ["/constructor", "/super"]) row(path, () => derived.router.run(path, body.n) + " | " + derived.router.run(path, body.five));
row("field read through any", () => untyped(new Service()).field(body.five, 1));
row("arrow returned by a method", () => untyped(new Service().makes())(body.five, 1));
console.log(app.count, derived.count);
