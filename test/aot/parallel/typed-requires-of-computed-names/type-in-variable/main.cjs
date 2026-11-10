const computed = name => "./" + name;
const show = run => {
  try {
    const value = run();
    console.log(JSON.stringify(value && typeof value === "object" && "default" in value ? value.default : value));
  } catch (error) {
    console.log("threw");
  }
};
const type = process.argv[9] ?? "json";
show(() => require(computed("code.cjs"), { type }));
console.log("ran", globalThis.ran ?? 0);
