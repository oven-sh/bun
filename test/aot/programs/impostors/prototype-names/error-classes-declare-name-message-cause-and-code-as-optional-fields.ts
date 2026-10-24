// Subclasses of Error declare fields that the built-in treats in three ways: `name` and `message` are on Error.prototype, `message` and `cause` become own properties only when the constructor is given them,
// `stack` is made by the engine, and `code` is the program's own. An empty slot must read what Error.prototype has, and the hidden own properties must stay hidden.
class HttpError extends Error {
  declare code?: number;
  declare cause?: unknown;
  declare detail?: string;
}
class NamedError extends Error {
  declare code?: number;
  constructor(message?: string, code?: number) {
    super(message);
    if (code !== undefined) this.code = code;
  }
}
function describe(error: HttpError) {
  return `${error.name}|${error.message}|${String(error.cause)}|${error.code}|${error.detail}|${String(error)}`;
}
function own(error: Error) {
  return `[${Object.keys(error)}] [${Object.getOwnPropertyNames(error).filter(name => !["stack", "line", "column", "sourceURL", "originalLine", "originalColumn"].includes(name))}]`;
}
function setCode(error: HttpError, code: number) {
  error.code = code;
}
function rename(error: Error, name: string) {
  error.name = name;
}
function setMessage(error: Error, message: string) {
  error.message = message;
}

let length = 0;
for (let i = 0; i < 2000; i++) {
  const error = i & 1 ? new HttpError("m" + (i & 3)) : new HttpError();
  if (i & 2) setCode(error, 404);
  if (i & 4) rename(error, "Renamed");
  length += describe(error).length + own(error).length;
}
console.log("warm", length);

const bare = new HttpError();
const given = new HttpError("given", { cause: "the cause" });
console.log("bare:", describe(bare), own(bare), "message" in bare, Object.hasOwn(bare, "message"), "cause" in bare);
console.log("given:", describe(given), own(given), Object.hasOwn(given, "message"), Object.hasOwn(given, "cause"), given.propertyIsEnumerable("message"));
setCode(bare, 500);
rename(bare, "Mine");
setMessage(bare, "stored later");
bare.cause = 1;
bare.detail = "d";
console.log("stored:", describe(bare), own(bare), bare.propertyIsEnumerable("message"), typeof bare.stack);
delete bare.cause;
delete (bare as any).name;
delete (bare as any).message;
console.log("deleted:", describe(bare), own(bare));
setMessage(given, "changed");
console.log("a hidden one stays hidden:", describe(given), own(given), given.propertyIsEnumerable("message"));
console.log("named:", [new NamedError(), new NamedError("m"), new NamedError("m", 7), new NamedError(undefined, 8)].map(error => `${error.message}|${error.code}|${own(error)}`).join(" "));
(HttpError.prototype as any)["name"] = "HttpError";
(HttpError.prototype as any)["code"] = 400;
console.log("the subclass's prototype gets name and code:", describe(new HttpError("x")), own(new HttpError("x")), "|", describe(given), "|", describe(bare), "|", new NamedError("y").name);
delete (HttpError.prototype as any).name;
delete (HttpError.prototype as any).code;
console.log("gone again:", describe(new HttpError("x")), JSON.stringify(bare));
