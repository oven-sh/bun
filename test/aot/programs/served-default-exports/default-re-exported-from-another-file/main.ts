// The default export comes from another file: an instance of a class with a getter named `stop`.
console.debug = (line: string) => {
  console.log(line.replace(/\d+$/, "PORT"));
  fetch(line.slice(line.indexOf("http"))).then(async response => {
    console.log(await response.text());
    process.exit(0);
  });
};

export { default } from "./config.ts";
