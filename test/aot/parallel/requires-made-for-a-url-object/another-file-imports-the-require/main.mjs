// A require that one file makes for itself and another file imports: the question on its base is asked where it is made, and the importer's loads come by the answer.
import { kept } from "./lib/maker.mjs";
import { moved } from "./lib/mover.mjs";
function report(way, act) {
  let said;
  try { said = act(); } catch (error) { said = error.code ?? error.name; }
  console.log(way + ":", said);
}
report("left alone", () => kept("./beside.cjs").said);
report("moved: the file beside the maker is taken for it", () => {
  let said;
  try { said = moved("./beside.cjs").said; } catch (error) { said = error.code; }
  return said === "beside the maker";
});
report("moved, a built-in module", () => typeof moved("node:path").join);
