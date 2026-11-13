import { nextTurns } from "../host.ts";
const response: any = {
  get sent(): boolean { return this.res.sent; },
  has(name: string): boolean { return this.res.names === name; },
};
class App {
  response: any;
  constructor() { this.response = Object.create(response); }
  create(req: unknown, res: unknown): any {
    const made = Object.create(this.response);
    made.app = this; made.req = req; made.res = res;
    return made;
  }
}
const app = new App();
const hidden = process.argv.length > 9 ? "x" : "";
const res = { sent: false, names: "a" }, req = { url: "/" };
let kept: unknown;
function bench(app: any, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const made = app.create(req, res);
    kept = made;
    if (made.res === res) s += 1;
  }
  return s;
}
const sink: any[] = [{ ["bench" + hidden]: bench }];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + sink[0]["bench" + hidden](app, n)) | 0;
console.log(check, typeof kept);
