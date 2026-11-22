// The formatter prints these out of their native fields and walks no prototype: no getter above them runs, and nothing of the library comes along.
// STATISTIC: ImageFunctionsEmitted <= 8
const timer = setTimeout(() => {}, 1);
console.log(timer, new Blob(["made up"]), new Request("http://made.up/"), new Response("made up"));
clearTimeout(timer);
