// Each table says how it is converted to a primitive, and that method stores to the table through `this`.
{
  const table = {
    first: "a",
    second: "b",
    toString() {
      this.second = "c";
      return "";
    },
  };
  `${table}`;
  for (const key of ["first", "second"]) console.log(require("./in-a-template/" + table[key] + ".cjs").who);
}
{
  const table = {
    first: "a",
    second: "b",
    toString() {
      this.second = "c";
      return "";
    },
  };
  table + "";
  for (const key of ["first", "second"]) console.log(require("./added-to-a-text/" + table[key] + ".cjs").who);
}
{
  const table = {
    first: "a",
    second: "b",
    valueOf() {
      this.second = "c";
      return 1;
    },
  };
  table < 2;
  for (const key of ["first", "second"]) console.log(require("./compared-with-a-number/" + table[key] + ".cjs").who);
}
{
  const table = {
    first: "a",
    second: "b",
    toString() {
      this.second = "c";
      return "key";
    },
  };
  ({})[table];
  for (const key of ["first", "second"]) console.log(require("./as-a-key/" + table[key] + ".cjs").who);
}
{
  const table = {
    first: "a",
    second: "b",
    toString() {
      this.second = "c";
      return "key";
    },
  };
  table in { key: 1 };
  for (const key of ["first", "second"]) console.log(require("./left-of-in/" + table[key] + ".cjs").who);
}
{
  const table = {
    first: "a",
    second: "b",
    toString() {
      this.second = "c";
      return "text";
    },
  };
  table != "other";
  for (const key of ["first", "second"]) console.log(require("./compared-with-a-text/" + table[key] + ".cjs").who);
}
