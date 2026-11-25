const computed = name => "./" + name;
const show = run => {
  try {
    const value = run();
    console.log(JSON.stringify(value && typeof value === "object" && "default" in value ? value.default : value));
  } catch (error) {
    console.log("threw");
  }
};
const options = { type: "json" };
show(() => require(computed("code.cjs"), options));
console.log("ran", globalThis.ran ?? 0);
