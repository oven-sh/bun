// Functions declared behind labels in sloppy-mode code: the function around them sees them, from its start. Plain Bun prints another output.
function attempt(label, run) {
  try {
    console.log(label + ":", run());
  } catch (error) {
    console.log(label + ":", "THROWS", error.constructor.name);
  }
}
attempt("read behind it", function () {
  label: function labeled() {}
  return typeof labeled;
});
attempt("read ahead of it", function () {
  var found = typeof labeled;
  label: function labeled() {}
  return found;
});
attempt("called ahead of it", function () {
  return labeled();
  label: function labeled() {
    return "called";
  }
});
attempt("behind two labels", function () {
  first: second: function labeled() {}
  return typeof labeled;
});
attempt("in a block", function () {
  {
    label: function labeled() {}
  }
  return typeof labeled;
});
label: function atTheTop() {}
console.log("at the top of the file:", typeof atTheTop);
/* Output:
read behind it: function
read ahead of it: function
called ahead of it: called
behind two labels: function
in a block: function
at the top of the file: function
*/
