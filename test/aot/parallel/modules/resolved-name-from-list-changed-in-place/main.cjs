// A resolver is asked for a file name, a part of which is read out of a list that the program changes after it is written, and its answer is loaded.
const walked = ["ONE", "TWO"];
walked.forEach((name, index, all) => {
  all[index] = name.toLowerCase();
});
console.log(require(require.resolve("./walked/" + walked[1] + ".cjs")).label);

const reversed = ["two", "one"];
reversed.reverse();
const found = require.resolve(`./reversed/${reversed[1]}.cjs`);
console.log(require(found).label);

const filled = ["ONE", "TWO"];
filled.fill("two");
console.log(require(require.resolve(["./filled", filled[1] + ".cjs"].join("/"))).label);

const copied = ["two", "ONE"];
copied.copyWithin(1, 0);
console.log(require.resolve(["./copied", copied[1] + ".cjs"].join("/")).slice(-15));

function change(list) {
  list[1] = "two";
}
const handed = ["ONE", "TWO"];
change(handed);
import(require.resolve("./handed/" + handed[1] + ".cjs")).then(loaded => console.log(loaded.default.label));
