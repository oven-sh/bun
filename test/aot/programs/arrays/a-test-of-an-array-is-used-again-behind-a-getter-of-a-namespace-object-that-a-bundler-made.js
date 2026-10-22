var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
  let target = {};
  for (var name in all) __defProp(target, name, { get: all[name], enumerable: true });
  if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
  return target;
};
function withProps(Component) {
  return function Wrapped(props) {
    return Component({ ...props, wrapped: true });
  };
}
var entry_exports = __exportAll({ default: () => handleRequest, streamTimeout: () => streamTimeout });
var streamTimeout = 5e3;
function handleRequest(request) {
  return "handled " + request;
}
var root_exports = __exportAll({ ErrorBoundary: () => ErrorBoundary, default: () => root_default, middleware: () => middleware });
var middleware = [async ({ request }, next) => {
  const response = await next();
  return response + request;
}];
var root_default = withProps(function App() {
  return "app";
});
var ErrorBoundary = withProps(function ErrorBoundary() {
  return "boundary";
});
var home_exports = __exportAll({ default: () => home_default, meta: () => meta });
function meta() {
  return [{ title: "smoke" }];
}
var home_default = withProps(function Home() {
  return "home";
});
var api_exports = __exportAll({ loader: () => loader });
function loader() {
  return "loaded";
}
var entry = { module: entry_exports };
var routes = {
  root: { id: "root", parentId: void 0, path: "", module: root_exports },
  home: { id: "home", parentId: "root", index: true, module: home_exports },
  api: { id: "api", parentId: "root", path: "api", module: api_exports },
};
function matchRoutes(path) {
  if (path === "/nowhere") return null;
  const list = path.length > 40 ? new Array(path.length - 40) : path.length > 30 ? [1.5] : [];
  list.length = 0;
  list.push({ params: {}, pathname: "/", route: routes.root });
  list.push({ params: {}, pathname: path, route: path === "/api" ? routes.api : routes.home });
  return path.length > 20 ? list.map(match => Object.assign({}, match)) : list;
}
async function handleResource(id) {
  return "resource " + id;
}
async function handleDocument(matches) {
  return "document " + (matches ? matches.map(match => match.route.module.default?.({})).join() : "none");
}
async function requestHandler(path, isSpaMode) {
  let matches = matchRoutes(path);
  let response;
  if (path.endsWith(".data")) response = entry.module.default(path) + (matches ? matches[0].pathname : "");
  else if (!isSpaMode && matches && matches[matches.length - 1].route.module.default == null && matches[matches.length - 1].route.module.ErrorBoundary == null) response = await handleResource(matches.slice(-1)[0].route.id);
  else response = await handleDocument(matches);
  return response;
}
const lines = [];
for (const path of ["/", "/api", "/nowhere", "/x.data", "/home"]) lines.push(await requestHandler(path, false));
for (let i = 0; i < 3000; i++) await requestHandler(i % 2 ? "/api" : "/", false);
console.log(lines.join("\n"));
