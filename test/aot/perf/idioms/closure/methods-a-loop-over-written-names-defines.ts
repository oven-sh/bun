import { nextTurns } from "../host.ts";
// A loop over a written list of names gives a class one method a name; each method is a closure over the name and calls a member of that name further in.
class Route {
  counts: any = { get: 0, post: 0, put: 0, delete: 0, patch: 0, head: 0 };
  [name: string]: any;
}
class Router {
  route = new Route();
  [name: string]: any;
}
const verbs = ["get", "post", "put", "delete", "patch", "head"];
verbs.forEach(function (verb) {
  Route.prototype[verb] = function (this: Route, by: number) {
    this.counts[verb] += by;
    return this;
  };
});
verbs.forEach(function (verb) {
  Router.prototype[verb] = function (this: Router, by: number) {
    const route = this.route;
    route[verb].call(route, by);
    return this;
  };
});
const router = new Router();
function bench(n: number): number {
  for (let i = 0; i < n; i++) router.get(i & 3).post(1).head(2);
  const counts = router.route.counts;
  return counts.get + counts.post + counts.head;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
