// An async function that is written to give a User returns a thenable, which resolves with a number, with an object of another class, and throws out of a getter `then`.
// Under: --aot-testing=CheckProofsAtRunTime: what the wait on a call of load() goes on with where the return is settled through a thenable (LinkedCoroutine::fulfilledWith)
class User {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
class Other {
  name = 7;
  extra = "other";
}
async function load(handed: unknown): Promise<User> {
  return handed as User;
}
async function deed(handed: unknown) {
  try {
    const user = await load(handed);
    return typeof user + " " + String(user && user.name);
  } catch (error) {
    return "thrown " + String(error);
  }
}
const resolvesWith = (value: unknown) => ({
  then(resolve: (value: unknown) => void) {
    resolve(value);
  },
});
console.log(await deed(new User("plain")));
console.log(await deed(resolvesWith(5)));
console.log(await deed(resolvesWith(new Other())));
console.log(await deed(resolvesWith(resolvesWith(new User("twice")))));
console.log(
  await deed({
    get then() {
      throw "no then";
    },
  }),
);
for (let i = 0; i < 300; i++) {
  if ((await deed(new User("x" + i))) !== "object x" + i) console.log("wrong at", i);
}
console.log(await deed(resolvesWith(null)));
console.log(await deed(new User("behind")));
