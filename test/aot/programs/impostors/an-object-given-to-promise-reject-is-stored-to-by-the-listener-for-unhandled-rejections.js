const box = { width: 1 };
process.once("unhandledRejection", o => {
  o.width = "wide";
  console.log("width + 1 is", box.width + 1);
});
Promise.reject(box);
