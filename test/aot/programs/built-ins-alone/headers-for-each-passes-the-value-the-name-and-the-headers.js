const headers = new Headers({ first: "1" });
headers.forEach(function (value, name, whole) {
  console.log(value.length, name, whole === headers, arguments.length);
});
