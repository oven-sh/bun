// A literal with a spread under a declared type: the spread brings values that the declared type of a field does not name, and names beyond the type.
type Options = { host: string; port: number; secure?: boolean; headers: { [name: string]: string } };
const loose: any = { host: 80, port: "eighty", extra: [1, 2], headers: null };
const typed: Options = { host: "a", port: 1, headers: { a: "b" } };

function merge(base: Options, port: number): Options {
  return { ...base, port };
}
function show(options: Options): string {
  return typeof options.host + " " + options.host + " " + typeof options.port + " " + options.port + " " + options.secure + " " + JSON.stringify(options.headers) + " " + Object.keys(options).join();
}
console.log(show(merge(typed, 2)));
console.log(show(merge(loose, 3)));
console.log(show({ ...loose }));
console.log(show({ ...typed, ...loose }));
console.log(show({ ...loose, ...typed }));
console.log(show({ ...typed, secure: true, headers: {} }));
const parsed: Options = JSON.parse('{"host":1,"port":"x","headers":[],"more":true}');
console.log(show(parsed), show({ ...parsed, host: "h" }));
