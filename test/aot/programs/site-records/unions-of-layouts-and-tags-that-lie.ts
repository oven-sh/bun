// A site whose type is a union of layouts reads the tag and then the fields of the member that the tag names. Honest members arrive in every order; then objects whose tag names another member, an unknown member, or changes between the test and the read.
interface Circle {
  kind: "circle";
  radius: number;
}
interface Rectangle {
  kind: "rectangle";
  width: number;
  height: number;
}
interface Label {
  text: string;
  kind: "label";
}
type Figure = Circle | Rectangle | Label;

function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
function kindOf(figure: Figure): string {
  return figure.kind;
}
function measure(figure: Figure): number | string {
  switch (figure.kind) {
    case "circle":
      return figure.radius * 2;
    case "rectangle":
      return figure.width * figure.height;
    case "label":
      return figure.text.length;
  }
}
function measureByFields(figure: Figure): number | string {
  if ("radius" in figure) return figure.radius;
  if ("width" in figure) return figure.width + figure.height;
  return figure.text;
}
function grow(figure: Figure): void {
  if (figure.kind === "circle") figure.radius += 1;
  else if (figure.kind === "rectangle") figure.width += 1;
  else figure.text += "+";
}
function look(mark: string, value: unknown): void {
  const figure = value as Figure;
  console.log(mark + ":", attempt(() => kindOf(figure)), attempt(() => measure(figure)), attempt(() => measureByFields(figure)), attempt(() => grow(figure)), attempt(() => measure(figure)), attempt(() => JSON.stringify(figure)));
}

look("circle", { kind: "circle", radius: 1 });
look("rectangle", { kind: "rectangle", width: 2, height: 3 });
look("label", { text: "label", kind: "label" });
look("circle", { kind: "circle", radius: 1.5 });
look("label", { text: "", kind: "label" });
look("rectangle", { kind: "rectangle", width: 2, height: 3 });
look("circle, fields in another order", { radius: 4, kind: "circle" });
look("rectangle, one more field", { kind: "rectangle", depth: 9, width: 2, height: 3 });
look("a circle that says rectangle", { kind: "rectangle", radius: 1 });
look("a rectangle that says circle", { kind: "circle", width: 2, height: 3 });
look("a label that says circle", { text: "label", kind: "circle" });
look("a circle that says label", { kind: "label", radius: 1 });
look("an unknown tag", { kind: "triangle", radius: 1, width: 2, height: 3, text: "all of them" });
look("no tag", { radius: 1 });
look("a tag put together", { kind: ["cir", "cle"].join(""), radius: 5 });
look("a tag that is a string object", { kind: new String("circle"), radius: 5 });
look("a tag that is a number", { kind: 0, radius: 5 });
look("parsed circle", JSON.parse('{"radius":6,"kind":"circle"}'));
look("parsed rectangle", JSON.parse('{"height":2,"kind":"rectangle","width":"3"}'));

let reads = 0;
look("a tag that changes with every read", {
  get kind() {
    return ["circle", "rectangle", "label"][reads++ % 3];
  },
  radius: 1,
  width: 2,
  height: 3,
  text: "text",
});
look("a tag whose getter removes the field", {
  get kind() {
    delete (this as any).radius;
    return "circle";
  },
  radius: 1,
});
look("null", null);
look("a text", "circle");
look("circle", { kind: "circle", radius: 1 });

export {};
