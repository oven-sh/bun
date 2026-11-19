// Prints the frames of errors that are thrown while a module converts an object to a text or a number in the expression that it exports by default.
const forms = [
  () => import("./form1.mjs"),
  () => import("./form2.mjs"),
  () => import("./form3.mjs"),
  () => import("./form4.mjs"),
  () => import("./form5.mjs"),
  () => import("./form6.mjs"),
  () => import("./form7.mjs"),
  () => import("./form8.mjs"),
  () => import("./form9.mjs"),
  () => import("./form10.mjs"),
  () => import("./form11.mjs"),
  () => import("./form12.mjs"),
  () => import("./form13.mjs"),
  () => import("./form14.mjs"),
  () => import("./form15.mjs"),
  () => import("./form16.mjs"),
  () => import("./form17.mjs"),
  () => import("./form18.mjs"),
  () => import("./form19.mjs"),
  () => import("./form20.mjs"),
  () => import("./form21.mjs"),
  () => import("./form22.mjs"),
  () => import("./form23.mjs"),
  () => import("./form24.mjs"),
  () => import("./form25.mjs"),
];
let index = 0;
for (const form of forms) {
  index++;
  try {
    await form();
    console.log(index, "loads");
  } catch (error) {
    const frames = error.stack.split("\n").slice(1);
    console.log(
      index,
      frames.map(line => line.trim().replace(/\(?[^ ()]*[\/\\]([\w-]+)\.mjs:(\d+:\d+)\)?/, "@$1:$2")).join(" < "),
    );
  }
}
