// Object.assign gives a literal a declared key ahead of the store that creates the next one.
type Options = { port: number; host?: string; path?: string };
function make(port: number, more: { path: string }): Options {
  const options: Options = { port };
  Object.assign(options, more);
  options.host = "localhost";
  return options;
}
console.log(Object.keys(make(1, { path: "/" })).join());
