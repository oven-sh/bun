const isDev = false;
const G = !isDev;
const R = isDev && G ? "http://localhost" : isDev || G ? "https://example.com" : "neither";
console.log(R);
