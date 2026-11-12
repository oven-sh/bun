// all, allSettled, race and any over promises that settle in turn
const later = (turns, value, fail) => (turns ? Promise.resolve().then(() => later(turns - 1, value, fail)) : fail ? Promise.reject(new Error(value)) : Promise.resolve(value));
async function run(a, b) {
  const list = () => [later(a, "a"), later(b, "b", true), "plain"];
  const settled = await Promise.allSettled(list());
  const race = await Promise.race([later(a, "a"), later(b, "b")]);
  const any = await Promise.any([later(a, "x", true), later(b, "y")]);
  const all = await Promise.all(list()).catch(error => "failed " + error.message);
  console.log(settled.map(one => one.value ?? one.reason.message).join(), race, any, all);
}
run(1, 3).then(() => run(4, 2)).then(() => run(0, 1));
