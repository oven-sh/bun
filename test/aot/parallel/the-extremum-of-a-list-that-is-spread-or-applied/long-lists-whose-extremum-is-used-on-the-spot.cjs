// The call stands in no tail position, so the function of the prelude is asked first: a list longer than the arguments that a call reserves room for goes as written, and is refused where plain refuses it.
// STATISTIC: LibraryFunctionsCalledDirectly >= 2
'use strict';
const out = [];
function all(label, list) {
  let said;
  try { const found = Math.max(...list); said = "max " + found; } catch (error) { said = "max " + error.constructor.name; }
  out.push(label + " " + said);
  try { const found = Math.min(...list); said = "min " + found; } catch (error) { said = "min " + error.constructor.name; }
  out.push(label + " " + said);
  try { const found = Math.max.apply(null, list); said = "applied max " + found; } catch (error) { said = "applied max " + error.constructor.name; }
  out.push(label + " " + said);
  try { const found = Math.min.apply(undefined, list); said = "applied min " + found; } catch (error) { said = "applied min " + error.constructor.name; }
  out.push(label + " " + said);
}
for (const n of JSON.parse("[65534,65535,65536,65537,1048576,1048577,2000000]")) { all("integers " + n, Array.from({ length: n }, (_, i) => (i * 7919) % 10007)); all("doubles " + n, Array.from({ length: n }, (_, i) => ((i * 7919) % 10007) + 0.5)); }
{ const list = []; list.length = 4294967295; all("a length alone", list); }
{ const list = [1]; list[5000000] = 1; all("a far place", list); }
console.log(out.join("\n"));
