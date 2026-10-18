// Only a type argument written on the global JSON validates. Written on globalThis.JSON.parse it is a type error: that function takes none.
interface User { id: number }
const misfit = '{"id":"one"}';
function viaGlobal(): unknown {
  try {
    return JSON.parse<User>(misfit);
  } catch (error: any) {
    return error.constructor.name;
  }
}
function withoutArgument(): unknown { return JSON.parse(misfit); }
function withCast(): unknown { return JSON.parse(misfit) as User; }
function withAnnotation(): unknown { const user: User = JSON.parse(misfit); return user; }
function withAny(): unknown { return JSON.parse<any>(misfit); }
function withUnknown(): unknown { return JSON.parse<unknown>(misfit); }
function shadowedByParameter(JSON: { parse<T>(text: string): T }): unknown { return JSON.parse<User>(misfit); }
function shadowedByVariable(): unknown {
  const JSON = { parse<T>(text: string): T { return ("mine " + text) as T; } };
  return JSON.parse<User>(misfit);
}
function heldAsValue(): unknown {
  const parse: <T>(text: string) => T = JSON.parse;
  return parse<User>(misfit);
}
function throughGlobalThis(): unknown { return globalThis.JSON.parse(misfit) as User; }
const own = { parse<T>(text: string): T { return globalThis.JSON.parse(text); } };
for (const [name, result] of [
  ["global", viaGlobal()],
  ["no argument", withoutArgument()],
  ["cast", withCast()],
  ["annotation", withAnnotation()],
  ["any", withAny()],
  ["unknown", withUnknown()],
  ["parameter", shadowedByParameter({ parse: <T,>(text: string) => ("theirs " + text) as T })],
  ["variable", shadowedByVariable()],
  ["value", heldAsValue()],
  ["globalThis", throughGlobalThis()],
  ["own object", own.parse<User>(misfit)],
]) console.log(name, JSON.stringify(result));
