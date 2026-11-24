// The initializer is a conditional expression; both of its branches are `any`.
function joined(a: any, b: any): any { return { ...a, ...b }; }
function stamped(desk: any, order: any): string {
  const marks: { boxes: { [name: string]: Object }; lids: string[] | false; inks?: number | string[] } =
    order.tray === undefined ? desk.notes.tray : joined(desk.notes.tray, order.tray);
  if (!marks?.lids) return "plain " + JSON.stringify(marks);
  if (typeof marks.lids === "string") marks.lids = [marks.lids];
  return marks.inks ? "stamped " + JSON.stringify(marks) : "no ink";
}
console.log(stamped({ notes: { tray: { path: "/" } } }, {}));
console.log(stamped({ notes: { tray: { path: "/" } } }, { tray: { isDry: true } }));
console.log(stamped({ notes: { tray: { lids: ["a"], inks: "s" } } }, { tray: { isDry: true } }));
console.log(stamped({ notes: {} }, {}));
