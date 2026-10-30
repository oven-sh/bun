// In sloppy code getFunction() of a call site answers the function under `bun run`. In an executable it answers undefined, as it does for a strict function.
function sitesHere() {
  const kept = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) => sites;
  const sites = new Error("here").stack;
  Error.prepareStackTrace = kept;
  return sites;
}
function outer() {
  return sitesHere();
}
const sites = outer();
console.log(sites.slice(0, 2).map(site => `${site.getFunctionName()} ${typeof site.getFunction()}`).join(", "));
/* Output:
sitesHere undefined, outer undefined
*/
