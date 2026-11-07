const day = new Date(0);
day[0] = "x";
day[1] = { v: 5 };
console.log(
  Object.values(day)
    .map(value => typeof value)
    .join(),
);
