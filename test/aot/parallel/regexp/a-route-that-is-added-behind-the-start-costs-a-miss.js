// The build calls the function that the first timer was handed with the router as the start of the program has left it: two routes, and their pattern is in the image. Before that function runs, the other timer has added a route
// whose text only the run knows: the pattern that the program makes has no record, nobody asks for the one in the image, and the run time's own matcher gives the answers of plain Bun.
// A wrong guess costs a miss, never a wrong match.
// COUNTER: RegExpsCreatedWithoutRecord = 1
// COUNTER: PredictedRegExpsCreated = 0
const routes = ["/a", "/b/[0-9]+"];
let matcher = null;
function match(path) {
  matcher ??= new RegExp("^(?:" + routes.join("|") + ")$");
  return matcher.test(path);
}
setTimeout(() => {
  console.log(matcher === null, ["/a", "/b/7", "/c", "/d", "/b/x"].map(path => (match(path) ? 1 : 0)).join(""), matcher.source);
}, 20);
setTimeout(() => {
  routes.push("/" + "c".repeat(Math.min(1, process.pid)));
}, 1);
