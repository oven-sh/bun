// `JSON.parse<T>(text)` validates: text that is no T throws. The same text behind `as T`, an annotation or a typed body is not validated and nothing throws: whatever was parsed passes, it stays what it was, and a field of another kind is read as what it is, as in plain Bun.
interface User { id: number; name: string }
const misfit = '{"id":"seven","name":"Ada"}';
const list = '[{"id":1,"name":"a"},{"id":"two","name":"b"},{"id":3,"name":"c"}]';
function idOf(user: User) { return user.id; }
function nameOf(user: User) { return user.name; }
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}

attempt("JSON.parse<User>, text that fits", () => JSON.parse<User>('{"id":7,"name":"Ada"}').id);
attempt("JSON.parse<User>, text that does not fit", () => JSON.parse<User>(misfit).name);
attempt("as User, the cast", () => typeof (JSON.parse(misfit) as User));
attempt("as User, a field that fits", () => nameOf(JSON.parse(misfit) as User));
attempt("as User, the field that does not fit", () => idOf(JSON.parse(misfit) as User));
attempt("an annotated variable, a field that fits", () => { const user: User = JSON.parse(misfit); return nameOf(user); });
attempt("the same field read through any", () => JSON.parse(misfit).id);
attempt("User[], each element by itself", () => {
  const users: User[] = JSON.parse(list);
  return users.map(user => { try { return idOf(user); } catch (e) { return (e as Error).constructor.name; } }).join();
});
attempt("as User, a number", () => JSON.parse("5") as User);
const body: User = await new Response(misfit).json();
attempt("a body, a field that fits", () => nameOf(body));
attempt("a body, the field that does not fit", () => idOf(body));
export {};
