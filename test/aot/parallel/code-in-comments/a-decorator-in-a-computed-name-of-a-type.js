// What stands in a comment is no code: a decorator that no class follows, in a computed name of the type of a `@type` tag.
globalThis.hit = () => {
  console.log("code in a comment ran");
  return () => {};
};
/** @type {{ [(@hit())]: number }} */
const o = {};
console.log(Object.keys(o).length);
