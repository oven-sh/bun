import * as list from "./list.json";
import * as text from "./text.json";
import * as nothing from "./null.json";
const show = ns =>
  console.log(
    Object.keys(ns)
      .filter(key => key !== "__esModule")
      .join("|"),
    JSON.stringify(ns.default),
  );
show(list);
show(text);
show(nothing);
