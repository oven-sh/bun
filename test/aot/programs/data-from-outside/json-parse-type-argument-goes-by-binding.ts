// Only a type argument written on the global JSON validates. Written on globalThis.JSON.parse it is a type error: that function takes none.
// On any other function a type argument is a type somebody wrote for the result: a claim, which nothing tests.
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
function nameOfError(run: () => unknown): unknown {
  try {
    return run();
  } catch (error: any) {
    return error.constructor.name + (error.issues ? " with issues" : " without issues");
  }
}
function shadowedByParameter(JSON: { parse<T>(text: string): T }): unknown { return JSON.parse<User>(misfit); }
function shadowedByVariable(): unknown {
  const JSON = { parse<T>(text: string): T { return ("mine " + text) as T; } };
  return JSON.parse<User>(misfit);
}
function shadowedAndGivesObject(JSON: { parse<T>(text: string): T }): unknown { return JSON.parse<User>(misfit); }
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
  ["parameter", nameOfError(() => shadowedByParameter({ parse: <T,>(text: string) => ("theirs " + text) as T }))],
  ["variable", nameOfError(shadowedByVariable)],
  ["parameter, an object", shadowedAndGivesObject({ parse: <T,>(text: string) => ({ theirs: text }) as T })],
  ["value", heldAsValue()],
  ["globalThis", throughGlobalThis()],
  ["own object", own.parse<User>(misfit)],
]) console.log(name, JSON.stringify(result));
