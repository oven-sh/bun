const options = {
  get cause() {
    console.log("cause");
    return { code: 1.5 };
  },
};
console.log(new Error("failed", options).cause.code + 1);
