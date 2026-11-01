const isDev = true;
let R;
switch (typeof isDev) {
  case "boolean":
    R = "http://localhost";
    break;
  case "number":
  case "string":
    R = "https://example.com";
    break;
  default:
    R = "other";
}
console.log(R);
