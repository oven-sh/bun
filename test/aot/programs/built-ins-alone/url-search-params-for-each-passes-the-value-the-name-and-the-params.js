const params = new URLSearchParams("first=1");
params.forEach(function (value, name, whole) {
  console.log(value.length, name, whole === params, arguments.length);
});
