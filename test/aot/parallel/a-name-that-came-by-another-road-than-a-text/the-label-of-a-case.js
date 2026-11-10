// The text is put together at run time, and a label of the switch lets it through.
function read(holder, name) {
  switch (name) {
    case "constructor":
    case "length":
      return holder[name];
  }
}
console.log(read(function () {}, JSON.parse('"con"') + "structor")("return 7")());
