const isDev = false;
let R = isDev;
R ??= "https://example.com";
console.log(R);
