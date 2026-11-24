const computed = name => "./" + name;
const show = run => {
  try {
    const value = run();
    console.log(JSON.stringify(value && typeof value === "object" && "default" in value ? value.default : value));
  } catch (error) {
    console.log("threw");
  }
};
show(() => require(process.argv.length > 9 ? "./absent.cjs" : "./data.json", { type: "text" }));
