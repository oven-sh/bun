process.on("unhandledRejection", (reason, promise) => {
  console.log(typeof reason, reason.code + 1, promise instanceof Promise);
});
Promise.reject({ code: 1.5 });
