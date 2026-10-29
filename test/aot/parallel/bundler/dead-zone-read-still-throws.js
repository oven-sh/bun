try {
  if (K) console.log("yes");
  else require("./missing");
} catch (e) {
  console.log(e.name);
}
const K = 1;
