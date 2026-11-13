if (process.argv[99])
  (() => {
    const [name] = ["./plain.cjs"];
    return require(name);
  })();
import("./plain.cjs").then(() => console.log("end"));
