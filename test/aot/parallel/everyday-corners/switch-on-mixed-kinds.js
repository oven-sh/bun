// Switch on mixed kinds: compiled answers as plain.
function s(x) {
  switch (x) {
    case 0:
      return "zero";
    case "0":
      return "text";
    case null:
      return "null";
    case undefined:
      return "undef";
    case NaN:
      return "nan";
    case false:
      return "false";
    default:
      return "other";
  }
}
for (const v of [0, -0, "0", null, undefined, NaN, false, "", []]) console.log(s(v));
