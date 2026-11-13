const computed = name => "./" + name;
const show = run => {
  try {
    const value = run();
    console.log(JSON.stringify(value && typeof value === "object" && "default" in value ? value.default : value));
  } catch (error) {
    console.log("threw");
  }
};
show(() =>
  require(computed("code.cjs"), {
    get type() {
      return "json";
    },
  }),
);
console.log("ran", globalThis.ran ?? 0);
