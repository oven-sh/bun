// Loops that are run twice: once nothing unusual happens, and once something does in an early iteration and never again. Every iteration behind that one should cost
// what it costs in the other run. ../equivalent-forms.test.ts holds each pair together.
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "64");

function sumOfList(list, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const value = list[i & 7];
    sum = (sum + (value === undefined ? list.push(1) : value)) | 0;
  }
  return sum;
}

// A push cannot change the box that the loop reads beside the list. The push that finds room goes on in the same loop, and the one that has to grow the list leaves from there.
function sumOfListAndBox(list, n, box) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const value = list[i & 7];
    sum = (sum + box.weight + box.names.length + (value === undefined ? list.push(1) : value)) | 0;
  }
  return sum;
}

const loops = {
  "a list of eight": n => sumOfList([1, 2, 3, 4, 5, 6, 7, 8], n),
  "a list of seven that gets its eighth in the loop": n => sumOfList([1, 2, 3, 4, 5, 6, 7], n),
  "a list of eight beside a box": n => sumOfListAndBox([1, 2, 3, 4, 5, 6, 7, 8], n, { weight: 1, names: ["a"] }),
  "a list of seven beside a box that gets its eighth in the loop": n => sumOfListAndBox([1, 2, 3, 4, 5, 6, 7], n, { weight: 1, names: ["a"] }),
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
