const isDev = true;
let R;
switch (Boolean(isDev)) {
  case true:
    R = "http://localhost";
    break;
  case false:
    R = "https://example.com";
    break;
}
console.log(R);
