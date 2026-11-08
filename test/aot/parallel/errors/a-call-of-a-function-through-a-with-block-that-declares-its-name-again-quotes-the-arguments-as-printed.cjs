// Inside `with`, a call of a function of the file can fail where a block of the body declares the name again with `var`: the object is asked first. The error quotes the call as Bun prints it.
// Todo: the error of a call of a name that a `with` object holds quotes the call without its arguments, `callee()`: also with no `var` and no function of that name in the file
function callee() {}
const scope = { callee: 5 };
try {
  with (scope) {
    {
      var callee;
      callee(function () { return    1; });
    }
  }
} catch (error) {
  console.log(error.message);
}
module.exports = 1;
