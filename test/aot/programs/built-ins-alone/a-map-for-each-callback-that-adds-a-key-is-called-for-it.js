const map = new Map([["first", 1]]);
map.forEach((value, key) => {
  console.log(key, typeof value);
  if (key === "first") map.set("second", "two");
});
