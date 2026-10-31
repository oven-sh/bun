const DAY = 6;
let kind;
switch (DAY) {
  case 0:
  case 6:
    kind = "weekend";
    break;
  case 5:
    kind = "almost";
  default:
    kind = kind ? kind + " weekday" : "weekday";
}
console.log(kind);
