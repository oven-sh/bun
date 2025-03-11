// Experiment
document.getElementById("bun-wumbo")?.remove();

console.log("hello");

globalThis.$send = () => {
  import.meta.hot.send("wumbo:data", {
    message: "hello",
  });
};

import.meta.hot.on("wumbo:meow", data => {
  console.log("meow", data);
});
