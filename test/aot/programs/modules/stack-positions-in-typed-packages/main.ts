// A stack frame in a package that is compiled from its typed version has the line and column of the installed JavaScript file, as in plain Bun.
// STATISTIC: TypedVersionsUsed = 2
import { afterText, callMissing, chained, construct, later, mapped, pagesOf, Shelf, tagged, take, where } from "shelf";
import { pay } from "ledger";

function frames(stack: string | undefined): string {
  return (stack ?? "")
    .split("\n")
    .filter(line => line.includes("node_modules"))
    .map(line => line.replace(/^.*node_modules\//, "").replace(/\)$/, ""))
    .join(" < ");
}

function caught(run: () => unknown): string {
  try {
    run();
    return "nothing was thrown";
  } catch (error) {
    return frames((error as Error).stack);
  }
}

const shelf = new Shelf().put("Emma", 474);
console.log("take:", caught(() => take(shelf, "Persuasion")));
console.log("put:", caught(() => shelf.put("Emma", -1)));
console.log("where:", frames(where()));
console.log("pay:", caught(() => pay(0)));
console.log("getter:", caught(() => new Shelf().first));
console.log("callback:", caught(() => shelf.each(book => take(shelf, book.title + "?"))));
console.log("arrow:", caught(() => pagesOf(shelf, "Sanditon")));
console.log("missing method:", caught(() => callMissing(shelf)));
console.log("construct:", caught(() => construct({})));
console.log("tag:", caught(() => tagged(undefined)));
console.log("map:", caught(() => mapped([{ name: "a" }, {}])));
console.log("chain:", caught(() => chained({ b: { c: () => undefined } })));
console.log("after text:", caught(() => afterText({})));
console.log("async:", await later(shelf, "Lady Susan").then(() => "nothing was thrown", error => frames(error.stack)));

const usual = Error.prepareStackTrace;
Error.prepareStackTrace = (_, sites) =>
  sites
    .filter(site => (site.getFileName() ?? "").includes("node_modules"))
    .map(site => (site.getFileName() ?? "").replace(/^.*node_modules\//, "") + " line " + site.getLineNumber() + " column " + site.getColumnNumber())
    .join(" < ");
try {
  take(shelf, "Sanditon");
} catch (error) {
  console.log("call sites:", (error as Error).stack);
}
Error.prepareStackTrace = usual;
