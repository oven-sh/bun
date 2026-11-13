import path from "node:path";
const load = folder => import.meta.require(path.join(folder, "good.json"));
console.log(JSON.stringify(load(process.argv[2] ?? import.meta.dirname)));
const data = process.env.MADE_UP_DATA_FOLDER || path.join(import.meta.dirname, "data");
console.log(JSON.stringify(import.meta.require(path.join(data, "more.json"))));
console.log(JSON.stringify((await import(`${process.argv[3] ?? import.meta.dirname}/good.json`)).default));
try {
  import.meta.require(path.join(process.argv[2] ?? import.meta.dirname, "broken.json"));
} catch (error) {
  console.log("threw", error.name);
}
