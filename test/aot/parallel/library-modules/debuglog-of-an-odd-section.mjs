import util from "node:util";
const found = util.debuglog({ toUpperCase: () => "constructor" });
console.log(
  found === Object
    ? found
        .getOwnPropertyDescriptor(
          Reflect.getPrototypeOf(function () {}),
          "constructor",
        )
        .value("return 6 * 7")()
    : "nothing is inherited",
);
