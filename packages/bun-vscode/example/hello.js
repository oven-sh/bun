// @bun
console.log("HELLO");
console.log(process.argv0);
console.log("HELLO 2");
console.log("HELLO 3");
a();

function a() {
  console.log("HELLO 4");
}

let i = 0;
while (true) {
  console.log(i);
  i++;
}