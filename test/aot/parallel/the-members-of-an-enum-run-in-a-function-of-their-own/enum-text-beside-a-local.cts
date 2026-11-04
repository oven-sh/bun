function run(p: string) {
  var q = "local";
  enum E { A = (eval("var q = 'enum'; var p = 'enum'"), 1) }
  return q + " " + p + " " + E.A;
}
console.log(run("parameter"));
