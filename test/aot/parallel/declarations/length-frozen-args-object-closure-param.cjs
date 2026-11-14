// Freezes and seals the arguments object of functions whose parameters a closure reads: its length stays the number of arguments handed in. Plain Bun prints another output.
function frozen(a, b) {
  var late = function () {
    return a;
  };
  Object.freeze(arguments);
  return [arguments.length, Object.keys(arguments).join()];
}
function sealed(a, b) {
  var late = function () {
    return a;
  };
  Object.seal(arguments);
  return [arguments.length, Object.keys(arguments).join()];
}
function closed(a, b) {
  var late = function () {
    return a;
  };
  Object.preventExtensions(arguments);
  return [arguments.length, Object.keys(arguments).join()];
}
function defined(a, b) {
  var late = function () {
    return a;
  };
  Object.defineProperty(arguments, "0", { value: "defined" });
  return [arguments.length, Object.keys(arguments).join()];
}
function described(a, b) {
  var late = function () {
    return a;
  };
  Object.getOwnPropertyDescriptors(arguments);
  return [arguments.length, Object.keys(arguments).join()];
}
function frozenWithoutAClosure(a, b) {
  Object.freeze(arguments);
  return [arguments.length, Object.keys(arguments).join()];
}
for (const run of [frozen, sealed, closed, defined, described, frozenWithoutAClosure])
  console.log(run.name + ":", JSON.stringify([run(), run(1), run(1, 2), run(1, 2, 3)]));
/* Output:
frozen: [[0,""],[1,"0"],[2,"0,1"],[3,"0,1,2"]]
sealed: [[0,""],[1,"0"],[2,"0,1"],[3,"0,1,2"]]
closed: [[0,""],[1,"0"],[2,"0,1"],[3,"0,1,2"]]
defined: [[0,""],[1,"0"],[2,"0,1"],[3,"0,1,2"]]
described: [[0,""],[1,"0"],[2,"0,1"],[3,"0,1,2"]]
frozenWithoutAClosure: [[0,""],[1,"0"],[2,"0,1"],[3,"0,1,2"]]
*/
