const isDev = true;
const Mode = { Dev: 0, Prod: 1 };
const mode = isDev ? Mode.Dev : Mode.Prod;
const R = mode === Mode.Dev ? "http://localhost" : "https://example.com";
console.log(R);
