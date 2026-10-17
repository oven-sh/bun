// A String object cast to `string & Removable` is accepted wherever a string is, including after an async function returns it.
class Removable extends String {
  [Symbol.dispose]() {
    console.log("removed " + this);
  }
}
function folder(base: string): string & Removable {
  return new Removable(base) as string & Removable;
}
function cacheOf(dir: string) {
  return { cache: dir + "/cache" };
}
function lockOf(dir: string) {
  return dir + "/bun.lock";
}
function look(dir: string) {
  return dir.length + ":" + dir.toUpperCase() + ":" + `${dir}` + ":" + dir.startsWith("/tmp");
}
async function setup(name: string) {
  const dir = folder("/tmp/" + name);
  console.log(cacheOf(dir).cache);
  await null;
  return dir;
}
const setupToo = async (name: string) => folder("/tmp/" + name);

async function main() {
  using dir = await setup("a");
  console.log(lockOf(dir), look(dir), cacheOf(dir).cache);
  console.log(JSON.stringify(String(dir)), [String(dir), "x"].join("/"));
  const second = await setup("b");
  console.log(lockOf(second), look(second));
  const promise = setupToo("c");
  using third = await promise;
  console.log(lockOf(third), look(third), lockOf(await setupToo("d")));
}
await main();
