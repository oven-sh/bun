const needles = { zero: 0, two: 2, three: 3, half: 1.5 };
for (const needle in needles) {
  const value = needles[needle];
  console.log(needle + " is " + value + " at " + [1, 2, 3, 0, 2].indexOf(value) + " and " + [1, 2, 3, 0, 2].lastIndexOf(value) + " found " + [1, 2, 3, 0, 2].includes(value));
}
for (const needle of Object.keys(needles)) console.log(needle + " at " + [1.5, 2, 0.5, 0].indexOf(needles[needle]));
