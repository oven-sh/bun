// Prints where an error at a member is reported that stands in a JSX element inside another element, with its `[` at the start of a line. A key that is a constant with a name for its value is printed behind a dot, as `quiet().getter`, and the frame is at what is mapped in front of it. Any other key is printed in brackets, and the frame is at that `[`.
/** @jsxImportSource ./eager */
function quiet() {}
const key = () => "getter";
const inThisFile = /[\\/]main\.jsx:/;
function show(label, run) {
  try {
    run();
    console.log(label, "| nothing is thrown");
  } catch (error) {
    const lines = String(error.stack)
      .split("\n")
      .filter(line => inThisFile.test(line));
    console.log(label, "|", error.name, "|", lines.map(line => /:(\d+:\d+)\)?$/.exec(line)[1]).join(" "));
  }
}
// prettier-ignore
{
show("a child of an element inside an element, by a constant that holds a name", () => {
  const name = "getter";
  return <div><span>{quiet()
    [name]}</span></div>;
});
show("an attribute of an element inside an element, by a constant that holds a name", () => {
  const name = "getter";
  return <div><span title={quiet()
    [name]} /></div>;
});
show("a child of an element inside an element, by a constant that holds a text with a dash", () => {
  const name = "a-b";
  return <div><span>{quiet()
    [name]}</span></div>;
});
show("a child of an element inside an element, by a call", () => {
  return <div><span>{quiet()
    [key()]}</span></div>;
});
show("a child of an element, by a constant that holds a name", () => {
  const name = "getter";
  return <div>{quiet()
    [name]}</div>;
});
show("an attribute of an element, by a constant that holds a name", () => {
  const name = "getter";
  return <div title={quiet()
    [name]} />;
});
}
