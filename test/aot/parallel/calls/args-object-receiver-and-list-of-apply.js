// An arguments object is the receiver and the list of one apply.
function printLargest() {
  console.log(Math.max.apply(arguments, arguments));
}
printLargest(1, 2);
printLargest();
printLargest(5, 3, 4);
