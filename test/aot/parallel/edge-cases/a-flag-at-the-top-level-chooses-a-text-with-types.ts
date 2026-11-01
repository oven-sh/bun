// A constant at the top level of a file chooses between two texts, with types beside it, which leave the text that is kept too.
const isDev: boolean = false;
const flag = false;
const url: string = flag ? "http://localhost" : "https://example.com";
console.log(url, isDev);
const port = (flag ? 3000 : 443) as number;
console.log(port);
