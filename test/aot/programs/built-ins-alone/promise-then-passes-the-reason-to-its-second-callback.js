await Promise.reject({ code: 1.5 }).then(null, function (reason) {
  console.log(typeof reason, reason.code + 1, this === undefined, arguments.length);
});
