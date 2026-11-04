const DELAY = 0;
const VALUES = [1, 2, 3];
async function load(v) {
  await new Promise((r) => setTimeout(r, DELAY));
  return v * 10;
}
Promise.all(VALUES.map(load)).then((all) => console.log(all, all.length === VALUES.length));
