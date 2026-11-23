// the sibling find_declaration_called_by_name() refuses a callee under a dynamic lookup; the `if` in walk_file() asks for eval alone. plain: declared of-the-box declared
function f(box) {
  function g() { return "declared"; }
  const a = () => { with (box) { return g(); } };
  const first = a();
  box.g = () => "of-the-box";
  const second = a();
  delete box.g;
  return first + " " + second + " " + a();
}
console.log(f({}));
