export var Exported;
(function (Exported) {
  Exported[(Exported["Off"] = 0)] = "Off";
  Exported[(Exported["On"] = 1)] = "On";
})(Exported || (Exported = {}));
export function changeExported() {
  Exported.On = "changed";
  Exported[1] = "changed too";
}
