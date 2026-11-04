// A constant at the top level of a file chooses between two texts, and the variable that holds the choice is read once.
const isDev = false;
const url = isDev ? "http://localhost" : "https://example.com";
console.log(url);
