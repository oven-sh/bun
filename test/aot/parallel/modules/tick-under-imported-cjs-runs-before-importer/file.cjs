console.log("file begins");
for (const name of ["./short.mjs", "./long.mjs"]) {
  try {
    require(name);
  } catch (error) {
    console.log("require throws", error.name);
  }
}
console.log("file ends");
