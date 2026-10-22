const print = text => console.log(text);
function make() {
  const made = async function() {}.constructor = 2;
}
function run() {
  let seen, line;
  const o = make();
  print("before: " + line)(() => {
    try {
      o.constructor;
    } catch (e) {}
  });
}
try {
  run();
} catch (e) {
  print("run threw " + e.name + ": " + e.message);
}
