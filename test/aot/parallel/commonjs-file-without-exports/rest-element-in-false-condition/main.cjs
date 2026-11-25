if (process.argv[99])
  (() => {
    const [, ...rest] = ["x", "./plain.cjs"];
    return require(rest[0]);
  })();
import("./plain.cjs").then(() => console.log("end"));
