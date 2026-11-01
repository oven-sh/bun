import { nextTurns } from "../host.ts";
const response = {
  get sent() { return this.res.sent; },
  has(name) { return this.res.names === name; },
};
class App {
  constructor() { this.response = Object.create(response); }
  create(req, res) {
    const made = Object.create(this.response);
    made.app = this; made.req = req; made.res = res;
    return made;
  }
}
const app = new App();
const hidden = process.argv.length > 9 ? "x" : "";
const res = { sent: false, names: "a" }, req = { url: "/" };
let kept;
function bench(app, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const made = app.create(req, res);
    kept = made;
    if (made.res === res) s += 1;
  }
  return s;
}
const sink = [{ ["bench" + hidden]: bench }];
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check = (check + sink[0]["bench" + hidden](app, n)) | 0;
console.log(check, typeof kept);
