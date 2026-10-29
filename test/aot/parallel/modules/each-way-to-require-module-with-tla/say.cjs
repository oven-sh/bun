function say(name, load) {
  let line;
  try {
    const loaded = load();
    line = Object.keys(loaded).join() + " " + loaded.a;
  } catch (error) {
    line = "throws " + error.name;
  }
  console.log(name, line);
}
module.exports = say;
