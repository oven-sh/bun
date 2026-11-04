function helper() { return "helped"; }
const arrow = () => "arrow";
class Tool {
  use() { return "used"; }
}
console.log(eval("helper()"), eval("arrow()"), eval("new Tool().use()"));
