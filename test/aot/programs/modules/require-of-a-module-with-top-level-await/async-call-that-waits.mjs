await (async () => {
  await 1;
})();
console.log("async-call-that-waits ran");
export const name = "async-call-that-waits";
