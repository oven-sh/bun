// `bun <file>` drops the directive of a function and runs it as sloppy code (docs/compiler/compatibility.mdx), so what is expected stands below: it is what Node prints.
const shelf = { count: 1, width: 1 };
const outcomes = [];
with (shelf) {
  const restock = function () {
    "use strict";
    count = (delete shelf.count, 2);
  };
  const widen = function () {
    "use strict";
    width += (delete shelf.width, 1);
  };
  for (const run of [restock, widen]) {
    try {
      run();
      outcomes.push("stored");
    } catch (error) {
      outcomes.push(error.name);
    }
  }
}
console.log(outcomes.join(), "count" in shelf, "width" in shelf);
/* Output:
ReferenceError,ReferenceError false false
*/
