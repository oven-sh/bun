// What the build lays beside a file for an eager entry of import.meta.glob is found from that file, under the specifier that the build has written there.
// A program that writes such a specifier itself finds nothing, as under plain Bun.
try {
  console.log(Object.keys(require("%glob::./dep.cjs")));
} catch {
  console.log("require threw");
}
import("%glob::./dep.cjs").then(
  all => console.log(Object.keys(all)),
  () => console.log("import threw"),
);
