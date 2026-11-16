// case: what tsc writes for an async function
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
  return new Promise(function (resolve) {
    var it = generator.apply(thisArg, _arguments || []);
    function step(result) { result.done ? resolve(result.value) : Promise.resolve(result.value).then(function (value) { step(it.next(value)); }); }
    step(it.next());
  });
};
Object.defineProperty(exports, "__esModule", { value: true });
const routes = (exports.routes = { home: "./b.cjs" });
function load() {
  return __awaiter(this, void 0, void 0, function* () {
    return (yield Promise.resolve(require(routes.home))).name;
  });
}
load().then(console.log);
