console.log([1.5, , 2.5].findIndex((value, index) => {
  console.log(typeof value, index);
  return value === undefined;
}));
