// `i in a` followed by `a[i]`: holes, indexes past the end, keys that are no index, every storage kind, and an array that changes between the test and the read.
function sumPresent(a) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) if (i in a) sum += a[i];
  return sum;
}

function joinPresent(a) {
  let text = "";
  for (let i = 0; i < a.length; i++) if (i in a) text += "[" + a[i] + "]";
  return text;
}

function readIfPresent(a, key) {
  if (key in a) return a[key];
  return "absent";
}

function readAfterTruncation(a, i) {
  if (i in a) {
    a.length = 0;
    return a[i];
  }
  return "absent";
}

function readAfterDeletion(a, i) {
  if (i in a) {
    delete a[i];
    return a[i];
  }
  return "absent";
}

function readAfterStore(a, i, value) {
  if (i in a) {
    a[i] = value;
    return a[i];
  }
  return "absent";
}

function readOtherIndex(a, i, j) {
  if (i in a) return a[j];
  return "absent";
}

function readOtherArray(a, b, i) {
  if (i in a) return b[i];
  return "absent";
}

function countAbsent(a, limit) {
  let absent = 0;
  for (let i = 0; i < limit; i++) if (!(i in a)) absent++;
  return absent;
}

for (let round = 0; round < 3; round++) {
  console.log(sumPresent([1, 2, 3, , 5, 6, , 8]), sumPresent([1.5, , 2.5, 3.25]), sumPresent([]), sumPresent([, , ,]));
  console.log(joinPresent(["a", , "b", undefined, null, , 0]), joinPresent([undefined]), joinPresent([1, , 2.5, "x"]));

  const integers = [10, 20, , 40];
  const doubles = [0.5, , 2.5];
  const values = ["x", , undefined, null];
  for (const a of [integers, doubles, values]) {
    console.log(
      readIfPresent(a, 0),
      readIfPresent(a, 1),
      readIfPresent(a, 2),
      readIfPresent(a, 3),
      readIfPresent(a, 4),
      readIfPresent(a, -1),
      readIfPresent(a, 1.5),
      readIfPresent(a, 4294967295),
      readIfPresent(a, 4294967296),
      readIfPresent(a, NaN),
      readIfPresent(a, "0"),
      readIfPresent(a, "length"),
    );
  }

  const named = [1, 2];
  named[-1] = "minus one";
  named[1.5] = "one and a half";
  named[4294967295] = "no index";
  console.log(readIfPresent(named, -1), readIfPresent(named, 1.5), readIfPresent(named, 4294967295), readIfPresent(named, 1), readIfPresent(named, 2));

  console.log(readAfterTruncation([1, 2, 3], 1), readAfterTruncation([1, , 3], 1), readAfterTruncation([0.5, 1.5], 1));
  console.log(readAfterDeletion([1, 2, 3], 1), readAfterDeletion(["a", "b"], 0), readAfterDeletion([0.5, 1.5], 5));
  console.log(readAfterStore([1, 2, 3], 1, "text"), readAfterStore([1, 2, 3], 1, 0.5), readAfterStore([0.5, 1.5], 0, undefined), readAfterStore([1, , 3], 1, 7));
  console.log(readOtherIndex([1, , 3], 0, 1), readOtherIndex([1, , 3], 0, 2), readOtherIndex([1, , 3], 0, 9), readOtherIndex([1, , 3], 1, 0));
  console.log(readOtherArray([1, 2], [, "b"], 0), readOtherArray([1, 2], [, "b"], 1), readOtherArray([1, 2], [], 1), readOtherArray([, 2], ["a"], 0));
  console.log(countAbsent([1, , 3], 5), countAbsent([], 3), countAbsent([0.5, 1.5], 2));

  const frozen = Object.freeze([1, , 3]);
  console.log(sumPresent(frozen), readIfPresent(frozen, 1), readIfPresent(frozen, 2));

  const sparse = [];
  sparse[100000] = 1;
  console.log(readIfPresent(sparse, 100000), readIfPresent(sparse, 99999), countAbsent(sparse, 10));
}
