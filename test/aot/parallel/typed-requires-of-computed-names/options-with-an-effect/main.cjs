const computed = name => "./" + name;
const show = run => {
  try {
    const value = run();
    console.log(JSON.stringify(value && typeof value === "object" && "default" in value ? value.default : value));
  } catch (error) {
    console.log("threw");
  }
};
let count = 0;
show(() => require(computed("data.json"), { type: "text", other: ++count }));
console.log("effects", count);
