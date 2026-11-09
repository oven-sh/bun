// Env: NAMES=a,b
for (const name of process.env.NAMES.split(",")) {
  let path = "./plugins/";
  path += name;
  path += ".cjs";
  console.log(require(path).mark);
}
